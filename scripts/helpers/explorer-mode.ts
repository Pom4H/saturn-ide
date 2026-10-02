import type { Page } from 'playwright';

export async function chooseExplorerMode(page: Page, mode: 'Код' | 'Объекты') {
  const trigger=page.getByRole('button',{name:/^(Режим навигатора|Режим проводника)$/});
  await trigger.click();
  const label=mode==='Код'?'Исходники · advanced':'Объект';
  const next=page.getByRole('menuitemcheckbox',{name:label,exact:true});
  if(await next.count())await next.click();
  else await page.getByRole('menuitemcheckbox',{name:mode,exact:true}).click();
}

export async function chooseExplorerLayout(page: Page, layout: 'Список' | 'Значки' | 'Папки' | 'Список файлов') {
  const trigger=page.getByRole('button',{name:/^(Вид навигатора|Вид проводника)$/});
  await trigger.click();
  await page.getByRole('menuitemcheckbox', { name: layout, exact: true }).click();
}
