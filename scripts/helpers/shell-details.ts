import type { Page } from 'playwright';

/** Exercise the single Shell-owned slot selector on desktop and mobile. */
export async function toggleShellDetails(page:Page, slot:'properties'|'review'|'catalog') {
  await page.getByRole('button',{name:'Содержимое боковой панели',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:slot==='properties'?'Свойства':slot==='review'?'Ревью':'Каталог оборудования',exact:true}).click();
}
