const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8')
const electronSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')

function section(start, end) {
  const from = source.indexOf(start)
  const through = source.indexOf(end, from)
  assert.notEqual(from, -1, `missing source section: ${start}`)
  assert.notEqual(through, -1, `missing source section boundary: ${end}`)
  return source.slice(from, through)
}

function electronSection(start, end) {
  const from = electronSource.indexOf(start)
  const through = electronSource.indexOf(end, from + start.length)
  assert.notEqual(from, -1, `missing Electron source section: ${start}`)
  assert.notEqual(through, -1, `missing Electron source section boundary: ${end}`)
  return electronSource.slice(from, through)
}

test('activity requests discard responses from a previous account', () => {
  const sessions = section('async function loadV3ActivitySessions', 'async function fetchV3ActivitySessionDetail')
  const detail = section('async function loadV3ActivityDetail', 'function selectV3ActivityDisplayRecord')
  const order = section('async function loadAPIOrderStatus', 'type V3ProviderListingsResponse')

  for (const value of [sessions, detail, order]) {
    assert.match(value, /const accountRevision = activityAccountRevision/)
    assert.match(value, /accountRevision !== activityAccountRevision|accountRevision === activityAccountRevision/)
  }
})

test('sign-out clears all account state and the next account reloads both order roles', () => {
  const reset = section('function resetAccountActivityState', 'function waitForWorkspacePaint')
  const accountReset = section('function resetAccountState', 'function waitForWorkspacePaint')
  const workspace = section('async function openWorkspace', 'const authGate')
  const authGate = section('const authGate', 'async function bootstrapWorkspace')

  assert.match(reset, /activityAccountRevision \+= 1/)
  assert.match(reset, /state\.v3ActivitySessions = \{ buyer: \[\], seller: \[\] \}/)
  assert.match(reset, /state\.v3ActivityLoaded = \{ buyer: false, seller: false \}/)
  assert.match(accountReset, /accountContextRevision \+= 1/)
  assert.match(accountReset, /resetAccountActivityState\(\)/)
  assert.match(accountReset, /state\.walletStatus = undefined/)
  assert.match(accountReset, /state\.v3Listings = \[\]/)
  assert.match(accountReset, /providerIntegrations = \[\]/)
  assert.match(accountReset, /state\.accountAPIKeyStatus = undefined/)
  assert.match(workspace, /nextAccountID !== previousAccountID\) resetAccountState\(\)/)
  assert.match(workspace, /loadV3ActivitySessions\('buyer', true\)/)
  assert.match(workspace, /loadV3ActivitySessions\('seller', true\)/)
  assert.match(authGate, /onSignedOut:[\s\S]*?resetAccountState\(\)/)
})

test('wallet, listings, and provider requests discard stale account responses', () => {
  const wallet = section('function refreshWalletStatus', 'function selectOrderSide')
  const listings = section('async function loadV3Listings', 'async function deleteV3ProviderListing')
  const integrations = section('async function refreshProviderIntegrations', 'function renderV3SellerSurface')

  for (const value of [wallet, listings, integrations]) {
    assert.match(value, /const accountRevision = accountContextRevision/)
    assert.match(value, /accountRevision !== accountContextRevision/)
  }
})

test('provider drafts are persisted under the active account namespace', () => {
  assert.match(source, /function providerAccountStorageKey/)
  assert.match(source, /state\.authAccount\?\.accountId/)
  assert.match(source, /providerPreparationDraftStoragePrefix/)
  assert.match(source, /providerPricingDraftStoragePrefix/)
  assert.match(source, /exora\.account\.providerPreparationDraft\./)
  assert.match(source, /exora\.account\.providerPricingDraft\./)
})

test('Desktop order history uses the signed-in session and V4 Order routes', () => {
  const list = electronSection('async function activity_sessions', 'async function activity_session')
  const detail = electronSection('async function activity_session', 'function desktopOrderSession')

  for (const value of [list, detail]) {
    assert.match(value, /cloudAuth\.apiRequest\('GET', `\/v4\/api-orders/)
    assert.doesNotMatch(value, /localOwnerToken|\/v4\/activity-sessions/)
  }
  assert.match(detail, /\/invocations\?/)
  assert.match(detail, /role=\$\{encodeURIComponent\(role\)\}/)
})

test('Desktop refreshes externally-created Agent orders and displays settlement totals', () => {
  const focus = section("window.addEventListener('focus'", "fields.agentMcpOnboarding.addEventListener('change'")
  assert.match(focus, /loadV3ActivitySessions\('buyer', true\)/)
  assert.match(focus, /loadV3ActivitySessions\('seller', true\)/)
  assert.match(source, /document\.visibilityState !== 'visible'[\s\S]*?loadV3ActivitySessions\('buyer', true\)[\s\S]*?loadV3ActivitySessions\('seller', true\)/)

  const session = electronSection('async function activity_session', 'function desktopOrderSession')
  const summary = electronSection('function desktopOrderSession', 'function desktopAPIOrder')
  assert.match(session, /chargedAtomic: Number\(value\.chargedAtomic \|\| 0\)/)
  assert.match(session, /platformFeeAtomic: Number\(value\.platformFeeAtomic \|\| 0\)/)
  assert.match(summary, /itemCount: Number\(order\.invocationCount \|\| 0\)/)
  assert.match(summary, /amountAtomic: Number\(order\.chargedAtomic \|\| 0\)/)
})

test('Buyer order rows expose persistent archive and safe delete actions from the context menu', () => {
  const archive = section('function archiveV3BuyerActivity', 'async function deleteV3BuyerActivity')
  const remove = section('async function deleteV3BuyerActivity', 'function orderSearchMatches')
  const menu = section('function openV3OrderContextMenu', 'function attachV3HistoryHandlers')

  assert.match(menu, /data-v3-order-context-action="archive"/)
  assert.match(menu, /data-v3-order-context-action="delete"/)
  assert.match(menu, /record\.role !== 'buyer'/)
  assert.match(archive, /v3ActivityMarker\(record\)/)
  assert.match(remove, /api_order_deactivate/)
  assert.match(remove, /v3ActivityMarker\(record, true, baselines\)/)
  assert.match(source, /!item\.deleted/)
})
