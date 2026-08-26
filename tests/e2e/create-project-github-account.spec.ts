import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const PERSONAL_ACCOUNT = {
  host: 'github.com',
  user: 'personal',
  active: true,
  envToken: null,
  source: 'keyring' as const,
  scopes: ['repo']
}
const WORK_ACCOUNT = {
  host: 'github.com',
  user: 'work',
  active: false,
  envToken: null,
  source: 'keyring' as const,
  scopes: ['repo']
}

test('creates a project with the selected GitHub account and no global Git identity', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await electronApp.evaluate(
    ({ ipcMain }, accounts) => {
      ipcMain.removeHandler('gh:diagnoseAuth')
      ipcMain.handle('gh:diagnoseAuth', () => ({
        ghAvailable: true,
        activeAccount: accounts.personal,
        accounts: [accounts.personal, accounts.work],
        envTokenInProcess: null,
        missingScopes: [],
        requiredScopes: [],
        hasKeyringFallback: false,
        requiredHost: null,
        requiredHostAuthenticated: null
      }))
      ipcMain.removeHandler('gh:resolveAuthorIdentity')
      ipcMain.handle('gh:resolveAuthorIdentity', (_event, args: { accountRef?: string }) => {
        if (args.accountRef !== 'gh:github.com:work') {
          return null
        }
        return {
          name: 'Work User',
          email: '123+work@users.noreply.github.com'
        }
      })
    },
    { personal: PERSONAL_ACCOUNT, work: WORK_ACCOUNT }
  )

  const parentPath = await orcaPage.evaluate(() => window.api.repos.getDefaultCreateProjectParent())
  const projectName = `github-account-${Date.now()}`
  const projectPath = path.join(parentPath, projectName)

  await orcaPage
    .getByRole('button', { name: /Add Project/i })
    .first()
    .click()
  const addDialog = orcaPage.getByRole('dialog', { name: /Add a project/i })
  await expect(addDialog).toBeVisible()
  await addDialog.getByRole('button', { name: /Create new project/i }).click()

  const createDialog = orcaPage.getByRole('dialog', { name: /Create a new project/i })
  await createDialog.locator('#create-project-name').fill(projectName)
  const accountPicker = createDialog.getByRole('combobox', { name: 'GitHub account' })
  await expect(accountPicker).toBeVisible()
  await accountPicker.click()
  await orcaPage.getByRole('option', { name: 'work (github.com)' }).click()
  await createDialog.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(createDialog).toBeHidden({ timeout: 30_000 })

  const localName = execFileSync('git', ['-C', projectPath, 'config', '--local', 'user.name'], {
    encoding: 'utf8'
  }).trim()
  const localEmail = execFileSync('git', ['-C', projectPath, 'config', '--local', 'user.email'], {
    encoding: 'utf8'
  }).trim()
  const commitIdentity = execFileSync(
    'git',
    ['-C', projectPath, 'log', '-1', '--format=%an <%ae>'],
    { encoding: 'utf8' }
  ).trim()

  expect(localName).toBe('Work User')
  expect(localEmail).toBe('123+work@users.noreply.github.com')
  expect(commitIdentity).toBe('Work User <123+work@users.noreply.github.com>')
})
