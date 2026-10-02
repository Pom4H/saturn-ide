import { useEffect, useState } from 'react';
import type { Locale } from '../core';

export type ThemeMode='system'|'light'|'dark';
export type LanguageMode='system'|Locale;
export type HomeIcon='home'|'site';
export type Accent='blue'|'teal'|'orange';
import type { InterfacePreset } from './model/navigation-catalog';
export type { InterfacePreset } from './model/navigation-catalog';
export function useInterfacePreferences(){
  const [preset,setPreset]=useState<InterfacePreset|null>(()=>{const value=localStorage.getItem('saturn.preset')??new URLSearchParams(location.search).get('preset');return value==='home'||value==='business'?value:null;});
  const [language,setLanguage]=useState<LanguageMode>(()=>{const value=localStorage.getItem('saturn.locale');return value==='ru'||value==='en'?value:'system';});
  const [theme,setTheme]=useState<ThemeMode>(()=>{const value=localStorage.getItem('saturn.theme');return value==='light'||value==='dark'?value:'system';});
  const [homeIcon,setHomeIcon]=useState<HomeIcon>(()=>localStorage.getItem('saturn.home.icon')==='site'?'site':localStorage.getItem('saturn.home.icon')==='home'?'home':preset==='business'?'site':'home');
  const [homeDimension,setHomeDimension]=useState<'2d'|'3d'>(()=>localStorage.getItem('saturn.home.dimension')==='2d'?'2d':'3d');
  const [accent,setAccent]=useState<Accent>(()=>{const value=localStorage.getItem('saturn.accent');return value==='blue'||value==='teal'||value==='orange'?value:preset==='home'?'teal':'blue';});
  const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
  const [systemLanguage,setSystemLanguage]=useState(()=>navigator.language.toLowerCase().startsWith('ru')?'ru' as const:'en' as const);
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(media.matches),languageChange=()=>setSystemLanguage(navigator.language.toLowerCase().startsWith('ru')?'ru':'en');media.addEventListener('change',change);addEventListener('languagechange',languageChange);return()=>{media.removeEventListener('change',change);removeEventListener('languagechange',languageChange);};},[]);
  const locale:Locale=language==='system'?systemLanguage:language,dark=theme==='dark'||theme==='system'&&systemDark;
  useEffect(()=>{document.documentElement.lang=locale;localStorage.setItem('saturn.locale',language);},[locale,language]);
  useEffect(()=>{if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;localStorage.setItem('saturn.theme',theme);},[theme]);
  useEffect(()=>{localStorage.setItem('saturn.home.icon',homeIcon);localStorage.setItem('saturn.home.dimension',homeDimension);localStorage.setItem('saturn.accent',accent);
    const colors={blue:dark?'#88acf0':'#3b66b0',teal:dark?'#76cfbd':'#197468',orange:dark?'#efb184':'#a64d20'};
    document.documentElement.style.setProperty('--accent',colors[accent]);document.documentElement.style.setProperty('--accent-soft','color-mix(in srgb,var(--accent) 13%,var(--panel))');
  },[homeIcon,homeDimension,accent,dark]);
  useEffect(()=>{if(preset)localStorage.setItem('saturn.preset',preset);},[preset]);
  const selectPreset=(value:InterfacePreset)=>{setPreset(value);setHomeIcon(value==='home'?'home':'site');setAccent(value==='home'?'teal':'blue');};
  return {locale,language,setLanguage,theme,setTheme,homeIcon,setHomeIcon,homeDimension,setHomeDimension,accent,setAccent,preset,selectPreset};
}
