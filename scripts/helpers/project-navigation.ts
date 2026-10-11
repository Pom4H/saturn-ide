import {expect,type Page} from 'playwright/test';
import {navigationCatalog} from '../../src/shell/model/navigation-catalog';
import type {EditorId} from '../../src/core/resources';

export async function revealProjectTree(page:Page){
 const sidebar=page.locator('.unified-sidebar');
 await expect(sidebar).toBeAttached({timeout:30000});
 if(await sidebar.isVisible())return;
 const mobile=page.getByRole('button',{name:/^(Открыть навигацию|Open navigation)$/});
 if(await mobile.isVisible())await mobile.click();
 else await page.getByRole('button',{name:/^(Показать боковую панель|Show sidebar)$/}).click();
 await expect(sidebar).toBeVisible();
}
export async function openProjectSurface(page:Page,editor:EditorId){
 await revealProjectTree(page);
 const primary=['diagram','hmi','performance','signals'].includes(editor);
 const back=page.locator('.project-return');
 if(primary&&await back.isVisible()){await back.click();await revealProjectTree(page);}
 if(editor==='signals'){
  await page.locator('[data-destination="performance"]').click();await revealProjectTree(page);
  await page.locator('[data-tree-id="monitor-signals"]').click();return;
 }
 const row=page.locator(`[data-destination="${editor}"]`);
 if(await row.isVisible()){await row.click();return;}
 const tools=page.getByRole('button',{name:/^(Инструменты проекта|Project tools)$/});
 const ru=await tools.getAttribute('aria-label')==='Инструменты проекта';
 await tools.click();
 await page.getByRole('menuitem',{name:navigationCatalog[editor].title[ru?'ru':'en'],exact:true}).click();
}
