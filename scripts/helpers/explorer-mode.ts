import type { Page } from 'playwright';
import {openProjectSurface} from './project-navigation';

export async function chooseExplorerMode(page: Page, mode: 'Код' | 'Объекты') {
  await openProjectSurface(page,mode==='Код'?'source':'diagram');
}

export async function chooseExplorerLayout(page: Page, layout: 'Список' | 'Значки' | 'Папки' | 'Список файлов') {
  const trigger=page.getByRole('button',{name:/^(Вид навигатора|Вид проводника)$/});
  if(await trigger.count())await trigger.click();
  else await page.getByRole('button',{name:'Действия проводника',exact:true}).click();
  await page.getByRole('menuitemcheckbox', { name: layout, exact: true }).click();
}
