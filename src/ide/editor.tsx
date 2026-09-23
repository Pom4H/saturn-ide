import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import { EditorState, Transaction } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { indentWithTab } from "@codemirror/commands";
import { api } from "./api";
import type { Locale, Problem } from "../core";
interface Props { path: string; source: string; locale: Locale; change: (source: string) => void; save: () => void; dragging: boolean }
export function Editor(props: Props) {
  const container = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null), current = useRef(props);
  current.current = props;
  useEffect(() => {
    const request = <T,>(operation: string, source: string, position = 0) => api<T>("language", { operation, path: current.current.path, source, position, locale: current.current.locale });
    const view = new EditorView({ parent: container.current!, state: EditorState.create({ doc: props.source, extensions: [
      basicSetup, javascript({ typescript: true, jsx: props.path.endsWith("tsx") }),
      keymap.of([indentWithTab, { key: "Mod-s", run: () => { current.current.save(); return true; } }]),
      EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(t => t.annotation(Transaction.userEvent) === "external")) current.current.change(update.state.doc.toString()); }),
      autocompletion({ override: [async context => {
        const word = context.matchBefore(/[\w$]*/);
        if (!word || word.from === word.to && !context.explicit) return null;
        try { const options = await request<{ label: string; type: string }[]>("complete", context.state.doc.toString(), context.pos); return context.aborted ? null : { from: word.from, options }; } catch { return null; }
      }] }),
      hoverTooltip(async (view, position) => {
        try {
          const info = await request<{ from: number; to: number; signature: string; documentation: string } | null>("hover", view.state.doc.toString(), position);
          if (!info) return null;
          return { pos: info.from, end: info.to, above: true, create: () => {
            const dom = document.createElement("div"), signature = document.createElement("pre"), documentation = document.createElement("p");
            dom.className = "jsdoc"; signature.textContent = info.signature; documentation.textContent = info.documentation; dom.append(signature, documentation); return { dom };
          } };
        } catch { return null; }
      }, { hoverTime: 300 }),
      linter(async view => {
        try { return (await request<Problem[]>("diagnostics", view.state.doc.toString())).map(p => ({ from: Math.min(p.from ?? 0, view.state.doc.length), to: Math.min(p.to ?? 0, view.state.doc.length), severity: "error" as const, message: `${p.code}: ${p.message[current.current.locale]}` })); } catch { return []; }
      }, { delay: 650 }),
      EditorView.theme({ "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--editor)", color: "var(--text)" }, ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }, ".cm-gutters": { backgroundColor: "var(--editor)", color: "var(--muted)", borderRight: "0" }, ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" }, ".cm-tooltip": { backgroundColor: "var(--panel)", borderColor: "var(--border)", color: "var(--text)" }, ".cm-content": { caretColor: "var(--text)" }, "&.cm-focused .cm-cursor": { borderLeftColor: "var(--text)" } }),
    ] }) });
    editor.current = view;
    return () => { view.destroy(); editor.current = null; };
  }, [props.path, props.locale]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== props.source) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.source }, annotations: [Transaction.userEvent.of("external"), Transaction.addToHistory.of(!props.dragging)] });
  }, [props.source, props.dragging]);
  return <div className="editor" ref={container} aria-label="TypeScript editor"/>;
}
