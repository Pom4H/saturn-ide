import type { Page } from 'playwright';

export async function chooseExplorerMode(page: Page, mode: 'Код' | 'Объекты') {
  await page.getByRole('button', { name: 'Режим проводника' }).click();
  await page.getByRole('menuitemcheckbox', { name: mode, exact: true }).click();
}

export async function chooseExplorerLayout(page: Page, layout: 'Список' | 'Значки' | 'Папки' | 'Список файлов') {
  await page.getByRole('button', { name: 'Вид проводника' }).click();
  await page.getByRole('menuitemcheckbox', { name: layout, exact: true }).click();
}
