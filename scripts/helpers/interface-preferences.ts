import type { BrowserContext, Page } from 'playwright';
import { expect } from 'playwright/test';

// Returning-user setup for legacy 2D acceptance cases. First-start/3D defaults
// are exercised separately by home-settings-browser-test, without this setup.
export async function prepareInterface(target: BrowserContext | Page) {
  await target.addInitScript(() => {
    for (const [key,value] of Object.entries({'saturn.preset':'business','saturn.locale':'ru','saturn.home.dimension':'2d'})) {
      if (localStorage.getItem(key)===null) localStorage.setItem(key,value);
    }
  });
}
export async function setInterfaceTheme(page: Page, theme: 'light' | 'dark') {
  await page.keyboard.press('ControlOrMeta+Comma');
  const settings=page.getByRole('region',{name:'Настройки интерфейса'});
  await expect(settings).toBeVisible();
  await page.getByRole('navigation',{name:'Разделы настроек'}).getByRole('button',{name:'Оформление',exact:true}).click();
  await settings.getByRole('button',{name:theme==='dark'?'Тёмный':'Светлый',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await page.getByRole('button',{name:'Назад',exact:true}).click();
  await expect(settings).toContainText('Язык');
  await page.getByRole('button',{name:'Назад',exact:true}).click();
  await expect(settings).toBeHidden();
}
