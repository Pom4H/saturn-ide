import { cableAppearance, interfaceProfile, type Locale, type Medium, type Role, type StandardInterfaceId } from '../core';

const roleLabels: Record<Role, Record<Locale, string>> = {
  source: { ru: 'Выход', en: 'Output' },
  sink: { ru: 'Вход', en: 'Input' },
  passive: { ru: 'Пассивный', en: 'Passive' },
};
const mediumLabels: Record<Medium, Record<Locale, string>> = {
  fluid: { ru: 'Жидкость', en: 'Fluid' },
  control: { ru: 'Управление', en: 'Control' },
  power: { ru: 'Питание', en: 'Power' },
  bus: { ru: 'Шина данных', en: 'Data bus' },
};
const valueTypeLabels: Record<'number'|'boolean'|'string', Record<Locale, string>> = {
  number: { ru: 'Число', en: 'Number' },
  boolean: { ru: 'Логическое', en: 'Boolean' },
  string: { ru: 'Строка', en: 'String' },
};
const interfaceLabels: Record<StandardInterfaceId, string> = {
  'rj45-ethernet': 'Ethernet · RJ45',
  'rs485-terminal': 'RS-485 · клемма',
  'control-screw': 'Управление · винтовой зажим',
  'fluid-flange': 'Жидкость · фланец',
  'power-terminal': 'Питание · клемма',
};
export const portRoleLabel = (role: Role, locale: Locale) => roleLabels[role][locale];
export const portMediumLabel = (medium: Medium, locale: Locale) => mediumLabels[medium][locale];
export const portValueTypeLabel = (type: 'number'|'boolean'|'string'|undefined, locale: Locale) => type ? valueTypeLabels[type][locale] : undefined;
export const portInterfaceLabel = (id: StandardInterfaceId|undefined, locale: Locale) => id ? locale === 'ru' ? interfaceLabels[id] : interfaceProfile(id).label : undefined;
export function cablePurposeLabel(medium: 'control'|'power'|'bus', family: string, locale: Locale) {
  if (locale === 'en') return cableAppearance(medium, family).label;
  if (medium === 'power') return 'Питание';
  if (medium === 'bus') return family === 'ethernet' ? 'Ethernet' : 'Последовательная шина';
  return ({ digital: 'Дискретное управление', analog: 'Аналоговое управление', temperature: 'Температура' } as Record<string,string>)[family] ?? 'Управление';
}
