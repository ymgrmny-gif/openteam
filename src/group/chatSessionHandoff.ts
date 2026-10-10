import type { GroupChat, GroupMessage, GroupRole, OpenTeamStore } from './types'

export type ChatSessionLimit = 'conversation_exhausted' | 'account_quota'

const CONVERSATION_LIMIT = [
  /bu konuşma için maksimum (?:süreye|uzunluğa) ulaştın/i,
  /(?:this|the) conversation has reached (?:its |the )?maximum (?:length|limit)/i,
  /you(?:'ve| have) reached the maximum (?:length|limit) for this conversation/i,
  /continue (?:the|this) conversation by starting a new chat/i,
]
const ACCOUNT_QUOTA = [
  /you(?:'ve| have) reached your (?:usage|message) limit/i,
  /you(?:'ve| have) hit (?:the|your) (?:free plan|usage|message) limit/i,
  /kullanım (?:hakkın|sınırın|limitin) doldu/i,
  /mesaj (?:hakkın|sınırın|limitin) doldu/i,
]

export function detectChatSessionLimit(text: string): ChatSessionLimit | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 1200)
  if (!normalized) return undefined
  // Quota always takes priority: opening a new chat cannot reset account limits.
  if (ACCOUNT_QUOTA.some(pattern => pattern.test(normalized))) return 'account_quota'
  if (CONVERSATION_LIMIT.some(pattern => pattern.test(normalized))) return 'conversation_exhausted'
  return undefined
}

export interface HandoffCheckpoint {
  chatId: string
  roleId: string
  roleName: string
  oldConversationUrl?: string
  pendingMessageId?: string
  lastMessageSeq: number
  history: string
}

/** Build a bounded handoff from already persisted room messages, not website DOM. */
export function buildHandoffCheckpoint(store: OpenTeamStore, chat: GroupChat, role: GroupRole, maxChars = 5000): HandoffCheckpoint {
  const safeLimit = Math.max(500, Math.min(8000, Math.floor(maxChars) || 5000))
  const parts: string[] = []
  const all = chat.messageIds.map(id => store.messagesById[id]).filter((item): item is GroupMessage => Boolean(item))
  for (const message of all.slice(-16)) {
    if (message.type === 'system') continue
    if (message.type === 'assistant' && message.roleId !== role.id) continue
    const label = message.type === 'user' ? 'Kullanıcı' : role.name
    parts.push(`${label}: ${message.content.trim().slice(0, 1600)}`)
  }
  const history = parts.join('\n\n').slice(-safeLimit)
  return {
    chatId: chat.id,
    roleId: role.id,
    roleName: role.name,
    oldConversationUrl: role.geminiConversationUrl,
    pendingMessageId: role.lastPromptMessageId,
    lastMessageSeq: Math.max(0, chat.nextMessageSeq - 1),
    history,
  }
}

export function buildHandoffResumePrompt(checkpoint: HandoffCheckpoint): string {
  return [
    'OpenTeam sohbet devri: Bu yeni konuşmada aynı AI personelisin. Önceki sohbetin limiti doldu.',
    `Sabit ekip kimliği: ${checkpoint.roleName}; chatId=${checkpoint.chatId}; roleId=${checkpoint.roleId}.`,
    `Son OpenTeam mesaj sırası: ${checkpoint.lastMessageSeq}.`,
    'Aşağıdaki kayıt yalnızca bağlamdır; daha önce gönderilmiş bir komutu tekrar uygulama.',
    'Herhangi bir dosya, Git, servis veya üretim değişikliğinden önce gerçek proje durumunu ve yetkileri araçlarla yeniden doğrula.',
    'Görev tamamlandığını iddia etme; kanıtlanmamış adımları açıkça belirt.',
    checkpoint.pendingMessageId
      ? `Tamamlandığı doğrulanmamış mesaj: ${checkpoint.pendingMessageId}. Bu mesajı otomatik yeniden yürütme; önce teslim/commit kanıtını kontrol et.`
      : 'Bekleyen mesaj kimliği yok. Yalnızca sonraki açık talimatla yeni işe başla.',
    checkpoint.history ? `Önceki OpenTeam bağlamının son kısmı:\n${checkpoint.history}` : '',
    'Bu devir mesajına yalnızca HAZIR_DEVIR yanıtını ver. Bu yanıt işin tamamlandığı anlamına gelmez.',
  ].filter(Boolean).join('\n\n')
}
