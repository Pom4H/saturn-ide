import { useEffect, useMemo, useState } from 'react';
import type { Locale, Project, Scenario } from '../core';
import { canonical } from '../core/artifact';
import type { JobReceipt } from '../core/jobs';
import type { ScenarioResult } from '../core/scenarios';
import { api } from './api';

export interface ScenarioView {
  available: boolean;
  reason: 'persistent-database' | 'simulation-required' | null;
  applied: string | null;
  run: { id: string } | null;
  clock: { timeMs: number; stepMs: number } | null;
  scenarios: Scenario[];
  jobs: JobReceipt[];
}
export interface ScenarioController {
  readonly view: ScenarioView | null;
  readonly definitions: readonly Scenario[];
  readonly definition: Scenario | undefined;
  readonly selected: string;
  readonly setSelected: (id: string) => void;
  readonly changed: boolean;
  readonly running: JobReceipt | undefined;
  readonly canRun: boolean;
  readonly canCancel: boolean;
  /** A successful observation from the current project/connection/visibility generation. */
  readonly fresh: boolean;
  readonly job: JobReceipt | undefined;
  readonly result: ScenarioResult | null | undefined;
  readonly recordedDefinition: Scenario | undefined;
  readonly error: string;
  readonly actionError: string;
  readonly busy: boolean;
  readonly chosenJob: string;
  readonly setChosenJob: (id: string) => void;
  readonly run: () => Promise<void>;
  readonly cancel: () => Promise<void>;
}
interface Scope { active: boolean; action?: AbortController }
interface Observation { projectId: string; scope: Scope; view: ScenarioView | null; error: string }
interface Action { scope: Scope; busy: boolean; error: string }
interface Selection { projectId: string | undefined; scenario: string; job: string }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * One scenario observer can serve several visible Shell controls. Source is a
 * fallback plan only: commands always use the observed applied definition and
 * CAS both the applied build and telemetry run at the runtime API boundary.
 */
export function useScenarioController(
  project: Project | undefined,
  authoringProject: Project | undefined,
  _locale: Locale,
  connected: boolean,
  enabled = true,
): ScenarioController {
  const projectId = project?.id;
  const [observation, setObservation] = useState<Observation | null>(null);
  const [selection, setSelection] = useState<Selection>({ projectId, scenario: '', job: '' });
  const [action, setAction] = useState<Action | null>(null);
  const [refresh, setRefresh] = useState(0);
  // A reconnect must not authorize actions using a formerly successful GET.
  // Identity changes in render, before the next effect can fetch a fresh view.
  const scope = useMemo<Scope>(() => ({ active: false }), [projectId, connected, enabled, refresh]);
  useEffect(() => {
    setSelection({ projectId, scenario: '', job: '' });
  }, [projectId]);
  useEffect(() => {
    if (!projectId || !enabled || !connected) return;
    scope.active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => scope.active && !controller.signal.aborted;
    const poll = async () => {
      try {
        const next = await api<ScenarioView>('scenarios', undefined, controller.signal);
        if (current()) setObservation({ projectId, scope, view: next, error: '' });
      } catch (error) {
        if (current()) setObservation(previous => ({ projectId, scope,
          view: previous?.projectId === projectId ? previous.view : null, error: message(error) }));
      } finally {
        if (current()) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      scope.active = false;
      controller.abort();
      scope.action?.abort();
      clearTimeout(timer);
    };
  }, [projectId, enabled, connected, scope]);

  // Keep the current project's last view readable while offline/hidden. Never
  // show another project's job, definition, error or selected scenario.
  const view = projectId && observation?.projectId === projectId ? observation.view : null;
  const error = observation?.scope === scope ? observation.error : '';
  const fresh = !!view && observation?.scope === scope && enabled && connected && !error;
  const busy = action?.scope === scope && action.busy;
  const actionError = action?.scope === scope ? action.error : '';
  const authored = authoringProject?.id === projectId ? authoringProject : project;
  const definitions = view?.scenarios.length ? view.scenarios : project ? authored?.scenarios ?? [] : [];
  const preferred = selection.projectId === projectId ? selection.scenario : '';
  const definition = definitions.find(item => item.id === preferred) ?? definitions[0];
  const selected = definition?.id ?? '';
  const appliedDefinition = view?.scenarios.find(item => item.id === selected);
  const changed = !!view?.applied && !!authoringProject && authoringProject.id === projectId
    && canonical(authoringProject.scenarios ?? []) !== canonical(view.scenarios);
  const running = view?.jobs.find(job => job.state === 'queued' || job.state === 'running');
  const canRun = fresh && !!definition && !!appliedDefinition && !!view?.available && !!view.applied && !!view.run
    && !busy && !running && (!appliedDefinition.steps.some(step => step.kind === 'advance') || !!view.clock);
  const canCancel = fresh && !!running && !busy;
  const preferredJob = selection.projectId === projectId ? selection.job : '';
  const job = view?.jobs.find(item => item.id === preferredJob) ?? view?.jobs[0];
  const chosenJob = job?.id ?? '';
  const result = job?.result as ScenarioResult | null | undefined;
  // Retained receipts may share a scenario ID with source or a later build.
  // Only that receipt's exact applied build can supply expected values/labels.
  const recordedDefinition = result && result.build === view?.applied
    ? view.scenarios.find(item => item.id === result.scenario) : undefined;
  const setSelected = (id: string) => setSelection(previous => ({ projectId, scenario: id,
    job: previous.projectId === projectId ? previous.job : '' }));
  const setChosenJob = (id: string) => setSelection(previous => ({ projectId, job: id,
    scenario: previous.projectId === projectId ? previous.scenario : '' }));

  const submit = async (path: 'scenarios/start' | 'scenarios/cancel', body: unknown) => {
    // This synchronous reservation also closes the double-click window before
    // React commits busy. A revoked scope cannot submit or publish late results.
    if (!scope.active || scope.action) return;
    const controller = new AbortController();
    scope.action = controller;
    setAction({ scope, busy: true, error: '' });
    try {
      const receipt = await api<JobReceipt>(path, body, controller.signal);
      if (!scope.active || controller.signal.aborted) return;
      if (path === 'scenarios/start') setChosenJob(receipt.id);
      // New receipt invalidates the last GET until the updated jobs arrive.
      setRefresh(value => value + 1);
    } catch (error) {
      if (scope.active && !controller.signal.aborted) setAction({ scope, busy: true, error: message(error) });
    } finally {
      scope.action = undefined;
      if (scope.active && !controller.signal.aborted) setAction(previous => previous?.scope === scope ? { ...previous, busy: false } : previous);
    }
  };
  const run = async () => {
    if (!canRun || !view?.run || !appliedDefinition) return;
    await submit('scenarios/start', { scenario: appliedDefinition.id, run: crypto.randomUUID(),
      expectedApplied: view.applied, expectedRun: view.run.id });
  };
  const cancel = async () => {
    if (!canCancel || !running) return;
    await submit('scenarios/cancel', { id: running.id });
  };
  return { view, definitions, definition, selected, setSelected, changed, running, canRun, canCancel, fresh,
    job, result, recordedDefinition, error, actionError, busy, chosenJob, setChosenJob, run, cancel };
}
