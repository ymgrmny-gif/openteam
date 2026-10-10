import type { ReplyImageSource } from '../../group/types'
import type { ChatSiteAdapter, ConversationSnapshot, SiteStatusInfo } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { readResponseTextFromCopyAction } from './clipboardCopy'
import { readEditorText } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton } from './waitForElement'

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com'])
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_CLIPBOARD_TIMEOUT_MS = 900
const DEFAULT_CLIPBOARD_POLL_MS = 40

const CHATGPT_SELECTORS = {
  // ChatGPT changes its form wrappers and editor IDs. Only consider identifiable composer fields.
  editor: '#prompt-textarea[contenteditable="true"], [data-testid="composer-input"][contenteditable="true"], form .ProseMirror[contenteditable="true"], form [role="textbox"][contenteditable="true"], textarea#prompt-textarea, textarea[data-testid="composer-input"]',
  sendButton:
    '#composer-submit-button, button[data-testid="send-button"], button[data-testid="composer-send-button"], button[aria-label*="Gönder"], button[aria-label*="发送"], button[aria-label*="Send"], button[aria-label*="提交"], button[aria-label*="Submit"], button[title="Gönder"]',
  response: '[data-message-author-role="assistant"]',
  // Current ChatGPT also renders assistant prose without the legacy author attribute.
  // Live ChatGPT 2026: answer prose lives in a styled ResponseRoot, not legacy turns.
  modernResponse: '[class*="ResponseRoot"], [data-testid^="conversation-turn-"] .markdown, main .markdown',
  imageResponse: '[data-conversation-screenshot-content]',
  generatedImage:
    'img[src*="/backend-api/estuary/content"], [data-testid*="image"] img[src], [class*="imagegen-image"] img[src]',
  responseActions: '[role="group"][aria-label="回复操作"], [role="group"][aria-label="Message actions"], [aria-label="回复操作"], [aria-label="Message actions"]',
  turnCopyButton: 'button[data-testid="copy-turn-action-button"], button[aria-label="复制回复"], button[aria-label="Copy response"]',
  copyButton:
    'button[data-testid="copy-turn-action-button"], button[aria-label="复制回复"], button[aria-label="Copy response"], button[aria-label="复制"], button[aria-label="Copy"]',
  turn: 'section[data-turn="assistant"][data-testid^="conversation-turn-"], [data-turn="assistant"][data-testid^="conversation-turn-"]',
  userTurn: '[data-turn="user"], [data-message-author-role="user"]',
  activityIndicator: '.result-streaming[aria-busy="true"], [aria-busy="true"] .result-streaming, [data-testid*="thinking"], [data-testid*="reasoning"]',
  errorDialog: '[role="dialog"] .text-red-500, .error-message, [data-testid="error-message"]',
  blockedPage: 'title:contains("Access Denied"), .cloudflare-challenge, [data-testid="access-denied"]',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface ChatGptAdapterOptions {
  href?: string
  inputTimeoutMs?: number
  sendAckTimeoutMs?: number
  clipboardTimeoutMs?: number
  clipboardPollMs?: number
}

export function createChatGptAdapter(options: ChatGptAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS
  const sendAckTimeoutMs = options.sendAckTimeoutMs ?? Math.max(inputTimeoutMs, 30_000)
  const clipboardTimeoutMs = options.clipboardTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const clipboardPollMs = options.clipboardPollMs ?? DEFAULT_CLIPBOARD_POLL_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getChatGptConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    const turnResponses = [...document.querySelectorAll(CHATGPT_SELECTORS.turn)]
      .map(turn => findPrimaryResponseInTurn(turn))
      .filter((response): response is Element => Boolean(response))
    const standaloneImageResponses = [...document.querySelectorAll(CHATGPT_SELECTORS.imageResponse)]
      .filter(response =>
        !response.closest(CHATGPT_SELECTORS.turn) &&
        !response.closest(CHATGPT_SELECTORS.userTurn) &&
        isGeneratedImageResponse(response),
      )
    const legacyResponses = turnResponses.length > 0
      ? turnResponses
      : [...document.querySelectorAll(CHATGPT_SELECTORS.response)]
    const textResponses = legacyResponses.length > 0
      ? legacyResponses
      : [...document.querySelectorAll(CHATGPT_SELECTORS.modernResponse)]
        .filter(element => !element.closest(CHATGPT_SELECTORS.userTurn))
    return uniqueElements([...textResponses, ...standaloneImageResponses])
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    if (!content.trim()) throw new Error('ChatGPT: empty prompt rejected')
    if (isChatGptGenerating()) throw new Error('ChatGPT is already generating; prompt not sent')

    const editor = await waitForUniqueComposer(inputTimeoutMs)
    // Never replace arbitrary drafts; recover only an exact draft fingerprint
    // previously recorded by OpenTeam in this same embedded tab session.
    const existingDraft = readComposerText(editor)
    if (existingDraft && !await matchesOwnedDraft(existingDraft)) {
      throw new Error('ChatGPT composer contains an existing draft; prompt not sent')
    }
    if (existingDraft && canonicalComposerText(existingDraft) !== canonicalComposerText(content)) {
      resetOwnedComposer(editor)
    }
    if (canonicalComposerText(readComposerText(editor)) !== canonicalComposerText(content)) writeComposerText(editor, content)
    if (canonicalComposerText(readComposerText(editor)) !== canonicalComposerText(content)) {
      throw new Error('ChatGPT editor did not accept the prompt text')
    }
    await rememberOwnedDraft(content)

    if (!autoSend) return

    const previousUserTurns = document.querySelectorAll(CHATGPT_SELECTORS.userTurn).length
    const previousAssistantReplies = getAllAssistantReplies().length
    const previousConversationId = getConversationSnapshot().conversationId
    const sendButton = await waitForComposerSendButton(editor, inputTimeoutMs)
    if (canonicalComposerText(readComposerText(editor)) !== canonicalComposerText(content) || isChatGptGenerating()) {
      throw new Error('ChatGPT composer changed before send; prompt not sent')
    }
    sendButton.click()
    // A dispatched click is not proof of delivery. Do not silently retry an uncertain send.
    await waitForSendAcknowledgement(content, previousUserTurns, previousAssistantReplies, previousConversationId, sendAckTimeoutMs, getAllAssistantReplies)
    forgetOwnedDraft()
  }

  return {
    id: 'chatgpt',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseImages: extractResponseImages,
    readResponseTextFromCopy: node => readResponseTextFromCopy(node, clipboardTimeoutMs, clipboardPollMs),
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isChatGptGenerating,
    checkStatus: checkChatGptStatus,
    stopGenerating: stopChatGptGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}


function canonicalComposerText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

const OWNED_CHATGPT_DRAFT_KEY = 'openteam:chatgpt:owned-draft:v1'
const OWNED_CHATGPT_DRAFT_TTL_MS = 20 * 60_000

interface OwnedChatGptDraft {
  version: 1
  digest: string
  createdAt: number
}

async function fingerprintDraft(text: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined
  const normalized = canonicalComposerText(text)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function matchesOwnedDraft(text: string): Promise<boolean> {
  try {
    const raw = sessionStorage.getItem(OWNED_CHATGPT_DRAFT_KEY)
    if (!raw) return false
    const owned: unknown = JSON.parse(raw)
    if (!owned || typeof owned !== 'object') return false
    const record = owned as Partial<OwnedChatGptDraft>
    if (record.version !== 1 || typeof record.createdAt !== 'number' ||
        !Number.isFinite(record.createdAt) || typeof record.digest !== 'string' ||
        Date.now() - record.createdAt < 0 || Date.now() - record.createdAt > OWNED_CHATGPT_DRAFT_TTL_MS) return false
    const digest = await fingerprintDraft(text)
    return Boolean(digest && record.digest === digest)
  } catch {
    return false
  }
}

async function rememberOwnedDraft(text: string): Promise<void> {
  try {
    const digest = await fingerprintDraft(text)
    if (!digest) return
    sessionStorage.setItem(OWNED_CHATGPT_DRAFT_KEY, JSON.stringify({
      version: 1,
      digest,
      createdAt: Date.now(),
    } satisfies OwnedChatGptDraft))
  } catch {
    // Draft ownership cannot be established; never clear an unknown draft later.
  }
}

function forgetOwnedDraft(): void {
  try {
    sessionStorage.removeItem(OWNED_CHATGPT_DRAFT_KEY)
  } catch {
    // Browsers may disallow frame storage. Preserve fail-closed behavior.
  }
}

function resetOwnedComposer(editor: ComposerEditor): void {
  if (editor instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!setter) throw new Error('ChatGPT owned textarea cannot be reset safely')
    setter.call(editor, '')
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
  } else {
    editor.focus()
    if (!editor.ownerDocument.execCommand('selectAll', false) ||
        !editor.ownerDocument.execCommand('delete', false)) {
      throw new Error('ChatGPT owned draft could not be cleared safely')
    }
  }
  if (readComposerText(editor)) throw new Error('ChatGPT owned draft remained after reset')
}

type ComposerEditor = HTMLElement

function findComposer(): ComposerEditor | null {
  const candidates = [...document.querySelectorAll<HTMLElement>(CHATGPT_SELECTORS.editor)]
    .filter(element => {
      if (element.closest('[hidden], [aria-hidden="true"]')) return false
      if (element.getAttribute('contenteditable') !== 'true' && !(element instanceof HTMLTextAreaElement)) return false
      if (element instanceof HTMLTextAreaElement && (element.disabled || element.readOnly)) return false
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden'
    })
  if (candidates.length > 1) throw new Error('ChatGPT has multiple composer candidates; prompt not sent')
  return candidates[0] ?? null
}

async function waitForUniqueComposer(timeoutMs: number): Promise<ComposerEditor> {
  const immediate = findComposer()
  if (immediate) return immediate
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      try {
        const editor = findComposer()
        if (editor) {
          window.clearInterval(interval)
          resolve(editor)
        } else if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(interval)
          reject(new Error('ChatGPT composer not found (missing or inaccessible iframe); prompt not sent'))
        }
      } catch (error) {
        window.clearInterval(interval)
        reject(error)
      }
    }, 200)
  })
}

function readComposerText(editor: ComposerEditor): string {
  return editor instanceof HTMLTextAreaElement ? editor.value.trim() : readEditorText(editor)
}

function writeComposerText(editor: ComposerEditor, content: string): void {
  if (editor instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!setter) throw new Error('ChatGPT textarea has no safe native setter')
    setter.call(editor, content)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }))
    editor.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  // Let the browser perform an actual editing transaction. Direct DOM writes
  // and synthetic input events can leave React/ProseMirror send state disabled.
  editor.focus()
  if (typeof editor.ownerDocument.execCommand !== 'function' ||
      !editor.ownerDocument.execCommand('insertText', false, content)) {
    throw new Error('ChatGPT native composer insertion unavailable; prompt not sent')
  }
}

async function waitForComposerSendButton(editor: ComposerEditor, timeoutMs: number): Promise<HTMLButtonElement> {
  // The 2026 ChatGPT composer can render its submit control outside the editor form.
  // Search the local form first, then the full page with strict button identity.
  const localScope = editor.closest('form') ?? editor.closest('[data-testid="composer"]')
  const findButton = (): HTMLButtonElement | null => {
    const isSafeSendButton = (button: HTMLButtonElement) => {
      if (!isClickableButton(button) || button.closest('[hidden], [aria-hidden="true"]')) return false
      const style = window.getComputedStyle(button)
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0' && style.pointerEvents !== 'none'
    }
    const fromScope = (scope: ParentNode): HTMLButtonElement | null => {
      const candidates = [...scope.querySelectorAll<HTMLButtonElement>(CHATGPT_SELECTORS.sendButton)]
        .filter(isSafeSendButton)
      if (candidates.length > 1) throw new Error('ChatGPT has ambiguous send buttons; prompt not sent')
      return candidates[0] ?? null
    }
    return (localScope ? fromScope(localScope) : null) ?? fromScope(document)
  }
  const immediate = findButton()
  if (immediate) return immediate
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      try {
        const button = findButton()
        if (button) {
          window.clearInterval(interval)
          resolve(button)
        } else if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(interval)
          reject(new Error('ChatGPT send button unavailable; prompt kept as draft'))
        }
      } catch (error) {
        window.clearInterval(interval)
        reject(error)
      }
    }, 200)
  })
}

async function waitForSendAcknowledgement(
  content: string,
  previousUserTurns: number,
  previousAssistantReplies: number,
  previousConversationId: string | undefined,
  timeoutMs: number,
  readAssistantReplies: () => string[],
): Promise<void> {
  const expected = canonicalComposerText(content)
  const acknowledged = () => {
    const newUserTurns = [...document.querySelectorAll(CHATGPT_SELECTORS.userTurn)].slice(previousUserTurns)
    if (newUserTurns.some(turn => canonicalComposerText(turn.textContent ?? '').includes(expected))) return true
    // ChatGPT can render the user message with a newer/collapsed DOM structure.
    // A *new* real assistant reply plus emptied composer is independent evidence
    // that this exact click was accepted; never count an existing old reply.
    // Route transitions often detach the old ProseMirror node; resolve its live replacement.
    const activeComposer = findComposer()
    if (!activeComposer || readComposerText(activeComposer) !== '') return false
    if (readAssistantReplies().length > previousAssistantReplies) return true
    if (isChatGptGenerating()) return true
    const currentConversationId = getChatGptConversationLocation(location.href).conversationId
    return Boolean(currentConversationId && currentConversationId !== previousConversationId)
  }
  if (acknowledged()) return
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      if (acknowledged()) {
        window.clearInterval(interval)
        resolve()
      } else if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval)
        reject(new Error('ChatGPT send was not acknowledged; do not retry automatically'))
      }
    }, 200)
  })
}

function checkChatGptStatus(): SiteStatusInfo {
  const timestamp = Date.now()

  // 1. Check for blockage (Cloudflare, Access Denied)
  if (document.title.includes('Access Denied') || document.querySelector('.cloudflare-challenge')) {
    return { status: 'blocked', detail: 'Access Denied / Cloudflare Challenge', timestamp }
  }

  // 2. Check for authentication issues
  if (location.pathname.includes('/auth/login') || location.pathname.includes('/login')) {
    return { status: 'unauthorized', detail: 'Session expired, please login', timestamp }
  }

  // 3. Check for explicit error messages in the UI
  const errorEl = document.querySelector(CHATGPT_SELECTORS.errorDialog)
  if (errorEl) {
    return { status: 'error', detail: errorEl.textContent?.trim() || 'Unknown API Error', timestamp }
  }

  // 4. Check if generating
  if (isChatGptGenerating()) {
    return { status: 'generating', detail: 'AI is thinking...', timestamp }
  }

  return { status: 'ready', timestamp }
}

async function readResponseTextFromCopy(node: Node, timeoutMs: number, pollMs: number): Promise<string | undefined> {
  return readResponseTextFromCopyAction({ node, timeoutMs, pollMs, findCopyButton })
}

function findCopyButton(response: Element): HTMLButtonElement | undefined {
  const turn = response.closest(CHATGPT_SELECTORS.turn) ?? response.parentElement
  const turnActionCopyButton = findTurnActionCopyButton(turn)
  if (turnActionCopyButton) return turnActionCopyButton

  return findLastClickableCopyButton(turn, CHATGPT_SELECTORS.copyButton)
}

function findTurnActionCopyButton(turn: Element | null): HTMLButtonElement | undefined {
  const actions = turn?.querySelector(CHATGPT_SELECTORS.responseActions)
  const button = actions?.querySelector<HTMLButtonElement>(CHATGPT_SELECTORS.turnCopyButton)
  return button && isClickableButton(button) ? button : undefined
}

function findLastClickableCopyButton(scope: Element | null, selectors: string): HTMLButtonElement | undefined {
  const buttons = [...(scope?.querySelectorAll<HTMLButtonElement>(selectors) ?? [])]
  return buttons.reverse().find(button => isClickableButton(button) && isVisibleElement(button))
}

export function getChatGptConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeChatGptUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeChatGptUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && CHATGPT_HOSTS.has(url.hostname) ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const directConversationId = url.pathname.startsWith('/c/') ? url.pathname.slice('/c/'.length).split('/')[0] : undefined
  const gptsConversationId = url.pathname.match(/^\/g\/[^/]+\/c\/([^/]+)/)?.[1]
  const conversationId = directConversationId ?? gptsConversationId
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: [...document.querySelectorAll(CHATGPT_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(CHATGPT_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  const turn = element?.closest(CHATGPT_SELECTORS.turn)
  const turnResponse = turn ? findPrimaryResponseInTurn(turn) : null
  if (turnResponse) return turnResponse

  const textResponse = findClosestMatchingAncestor(element, CHATGPT_SELECTORS.response)
  if (textResponse) return textResponse

  const modernResponse = findClosestMatchingAncestor(element, CHATGPT_SELECTORS.modernResponse)
  if (modernResponse && !modernResponse.closest(CHATGPT_SELECTORS.userTurn)) return modernResponse

  const imageResponse = findClosestMatchingAncestor(element, CHATGPT_SELECTORS.imageResponse)
  return imageResponse &&
    !imageResponse.closest(CHATGPT_SELECTORS.userTurn) &&
    isGeneratedImageResponse(imageResponse)
    ? imageResponse
    : null
}

function isChatGptGenerating(): boolean {
  return Boolean(findChatGptStopButton() || findChatGptActivityIndicator())
}

async function stopChatGptGenerating(): Promise<boolean> {
  const button = findChatGptStopButton()
  if (!button) return false
  button.click()
  return true
}

function findChatGptStopButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableButton(button) && isVisibleInteractiveElement(button))
}

function findChatGptActivityIndicator(): Element | undefined {
  const explicitIndicator = [...document.querySelectorAll(CHATGPT_SELECTORS.activityIndicator)].find(isVisibleOrDocumentedIndicator)
  if (explicitIndicator) return explicitIndicator

  return [...document.querySelectorAll(CHATGPT_SELECTORS.turn)].reverse().find(turn => {
    if (turn.getAttribute('data-turn') !== 'assistant') return false
    return hasShortThinkingStatus(turn)
  })
}

function hasShortThinkingStatus(scope: Element): boolean {
  return [...scope.querySelectorAll<HTMLElement>('div, span, p')].some(element => {
    if (!isVisibleOrDocumentedIndicator(element)) return false
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 80) return false
    return /^(正在)?思考中?[。.．…\s]*$|^thinking[.\s…]*$|^reasoning[.\s…]*$/i.test(text)
  })
}

function findPrimaryResponseInTurn(turn: Element): Element | null {
  const textResponse =
    turn.querySelector('[data-message-author-role="assistant"][data-turn-start-message="true"]') ??
    turn.querySelector('[data-message-author-role="assistant"][data-message-id]') ??
    turn.querySelector(CHATGPT_SELECTORS.response)
  if (textResponse) return textResponse

  const screenshotResponse = turn.querySelector(CHATGPT_SELECTORS.imageResponse)
  return screenshotResponse && isReportableScreenshotResponse(screenshotResponse) ? screenshotResponse : null
}

function isGeneratedImageResponse(element: Element): boolean {
  return extractResponseImages(element).length > 0
}

function isReportableScreenshotResponse(element: Element): boolean {
  return isGeneratedImageResponse(element) || Boolean(extractCleanText(element).trim())
}

function extractResponseImages(node: Node): ReplyImageSource[] {
  const scope = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  if (!scope) return []

  const bySourceUrl = new Map<string, ReplyImageSource>()
  for (const image of scope.querySelectorAll<HTMLImageElement>(CHATGPT_SELECTORS.generatedImage)) {
    const sourceUrl = normalizeGeneratedImageUrl(image.currentSrc || image.src)
    if (!sourceUrl) continue

    const current = bySourceUrl.get(sourceUrl)
    const candidate: ReplyImageSource = {
      sourceUrl,
      ...(image.alt.trim() ? { alt: image.alt.trim() } : {}),
      ...readImageDimensions(image),
    }
    bySourceUrl.set(sourceUrl, mergeImageCandidate(current, candidate))
  }

  return [...bySourceUrl.values()]
}

function normalizeGeneratedImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value, location.href)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function readImageDimensions(image: HTMLImageElement): Pick<ReplyImageSource, 'width' | 'height'> {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  return {
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
  }
}

function mergeImageCandidate(current: ReplyImageSource | undefined, candidate: ReplyImageSource): ReplyImageSource {
  if (!current) return candidate
  return {
    sourceUrl: current.sourceUrl,
    alt: current.alt ?? candidate.alt,
    width: current.width ?? candidate.width,
    height: current.height ?? candidate.height,
  }
}

function uniqueElements(elements: Element[]): Element[] {
  return [...new Set(elements)]
}

function isVisibleElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  return element.getClientRects().length > 0 || Boolean((element as HTMLElement).offsetParent)
}

function isVisibleInteractiveElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.pointerEvents === 'none') return false
  return isVisibleElement(element)
}

function isVisibleOrDocumentedIndicator(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false
  return isVisibleElement(element) || element.hasAttribute('aria-busy') || Boolean(element.getAttribute('data-testid'))
}
