import type { BuildPromptInput } from './promptBuilder'
import type { GroupChat, GroupRole, MessageReference } from './types'
import { formatContextMessage } from './contextSync'
import { PROMPT_I18N } from '../shared/i18n'

function join(sections: Array<string | undefined>): string {
  return sections.filter((value): value is string => Boolean(value?.trim())).join('\n\n')
}

function roleDetails(role: GroupRole, includePersona: boolean): string {
  return join([
    role.description ? `Sorumluluğun:\n${role.description}` : undefined,
    includePersona && role.systemPrompt ? `Rol yönergen:\n${role.systemPrompt}` : undefined,
  ])
}

function referenceDetails(reference?: MessageReference): string | undefined {
  if (!reference) return undefined
  const speaker = reference.roleName ? `${reference.roleName} adlı ekip üyesinin sözleri` : 'önceki bir mesaj'
  return `Kullanıcı ${speaker} hakkında alıntı yaptı:\n"${reference.contentSnapshot}"\nBu alıntıya doğrudan yanıt ver.`
}

function newContext(input: BuildPromptInput): string {
  if (input.unsyncedContext) {
    const message = input.unsyncedContext.contextText
    return join([
      input.unsyncedContext.omittedEarlyContext ? 'Önceki konuşmanın bir bölümü yer sınırı nedeniyle atlandı.' : undefined,
      message ? `Son yanıtından bu yana sohbete eklenenler:\n${message}` : 'Son yanıtından bu yana eşitlenecek yeni bir mesaj yok.',
    ])
  }
  const messages = input.unsyncedMessages ?? []
  if (messages.length === 0) return ''
  const context = messages.map(message => formatContextMessage(message, 'tr')).join('\n\n')
  const limit = input.maxContextChars ?? 6000
  const prefix = context.length > limit ? 'Önceki konuşmanın bir bölümü atlandı.\n\n' : ''
  return `${prefix}Son yanıtından bu yana sohbete eklenenler:\n${context.slice(-limit).trimStart()}`
}

export function buildTurkishIndependentPrompt(input: BuildPromptInput): string {
  const reference = input.reference ?? input.userMessage.references?.[0]
  return join([
    `Rolün: "${input.role.name}".`,
    roleDetails(input.role, input.includePersona ?? true),
    referenceDetails(reference),
    `Kullanıcının mesajı:\n${input.userMessage.content}`,
    input.responseInstruction ?? `"${input.role.name}" rolünde bağımsız yanıt ver. ${PROMPT_I18N.tr.responseLanguageInstruction}${reference ? ' Alıntıya katıldığın ve katılmadığın noktaları, gerekçeleriyle açıkla.' : ''}`,
  ])
}

export function buildTurkishCollaborativePrompt(input: BuildPromptInput): string {
  const reference = input.reference ?? input.userMessage.references?.[0]
  return join([
    'Bir yapay zekâ ekip sohbetindesin.',
    `Ekip üyeleri:\n${input.roles.map(role => `- ${role.name}${role.description ? ': ' + role.description : ''}`).join('\n')}`,
    `Senin rolün: "${input.role.name}".`,
    roleDetails(input.role, input.includePersona ?? true),
    newContext(input),
    referenceDetails(reference),
    `Kullanıcının son mesajı:\n${input.userMessage.content}`,
    input.responseInstruction ?? `"${input.role.name}" olarak yanıt ver. Diğer ekip üyelerinin görüşlerini değerlendir, gerekirse tamamla veya karşı çık. ${PROMPT_I18N.tr.responseLanguageInstruction}${reference ? ' Kullanıcının alıntıladığı görüşe açıkça yanıt ver.' : ''}`,
  ])
}

export function buildTurkishInitializationPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona: boolean): string {
  if (chat.mode === 'collaborative') {
    return join([
      'Bir yapay zekâ ekip sohbetindesin.',
      `Ekip üyeleri:\n${roles.map(member => `- ${member.name}${member.description ? ': ' + member.description : ''}`).join('\n')}`,
      `Senin rolün: "${role.name}".`,
      roleDetails(role, includePersona),
      `Atanmış rolünü koru. Diğer ekip üyelerinin düşüncelerini destekleyebilir, tamamlayabilir ya da gerekçeli biçimde eleştirebilirsin. Kullanıcı bir yanıtı alıntılarsa doğrudan o yanıta odaklan. ${PROMPT_I18N.tr.responseLanguageInstruction}`,
    ])
  }
  return join([
    `Rolün: "${role.name}".`,
    roleDetails(role, includePersona),
    `Kullanıcının vereceği görevlere kendi uzmanlık alanında bağımsız yanıt ver. Başka bir ekip üyesinin varlığını varsayma. ${PROMPT_I18N.tr.responseLanguageInstruction}`,
  ])
}
