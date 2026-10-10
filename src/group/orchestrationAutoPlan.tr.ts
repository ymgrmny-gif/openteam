import type { AutoOrchestrationPromptInput } from './orchestrationAutoPlan'
import { PROMPT_I18N } from '../shared/i18n'

/** Keep JSON contract field names stable, while all guidance and proposed content are Turkish. */
export function buildTurkishAutoOrchestrationPrompt(input: AutoOrchestrationPromptInput): string {
  const lines = [
    'OpenTeam için yürütülebilir bir yapay zekâ görev akışı tasarlayan planlayıcısın.',
    PROMPT_I18N.tr.jsonOnly,
    '',
    'Amaç: Göreve ve kullanıcının açıklamasına göre düzenlenebilir bir görev akışı oluşturmak veya var olan akışı değiştirmek.',
    'Görevin hedefi ile akışın nasıl kurulacağına ilişkin yönergeyi birbirine karıştırma.',
    'currentFlow varsa kullanıcı değişiklik istemediği rol, adım ve bağlantıları koru.',
    '',
    'Zorunlu kurallar:',
    '1. Mevcut roller görev için uygunsa yeni rol açmak yerine mevcut rolü kullan. Bu durumda roles[].reuseRoleId alanına mevcut rol kimliğini yaz.',
    '2. Yalnızca gerekli sorumluluk karşılanmıyorsa yeni rol oluştur.',
    '3. Hiç rol yoksa 2 ile 5 arasında rol oluştur.',
    '4. preferredSite yalnızca chatgpt, gemini, claude, deepseek veya grok olabilir. Kullanıcı bir hizmeti özellikle belirttiyse ilgili rol için onu kullan.',
    '5. kind=parallel adlı adım oluşturma; aynı adımdan birden fazla sonraki adıma bağlantı kurarak paralel çalışmayı ifade et.',
    '6. Bir adıma birden fazla bağlantı geliyorsa adım, önceki adımlar tamamlanınca başlamalı.',
    '7. Aynı rol paralel çalışabilecek iki adımda yer alamaz; o rolün görevlerini sıralı düzenle.',
    '8. Görev adımları kind=execute, inceleme adımları kind=review olmalı.',
    '9. Her adımda tam bir roleKey bulunmalı.',
    '10. İnceleme adımlarında review.criteria, review.maxAttempts ve review.onMaxAttempts alanları zorunlu.',
    '11. İnceleme başarısızsa fail bağlantısıyla düzeltme adımına dönülebilir. pass bağlantısı yoksa başarılı incelemeden sonra akış biter.',
    '12. Bağlantısız veya erişilemeyen adım oluşturma.',
    '13. En fazla 8 adım oluştur.',
    '14. maxNodeExecutions görev karmaşıklığına göre ayarlanmalı; varsayılan 30.',
    '15. Yeni oluşturulan rollerin açıklaması ve sistem yönergesi düzenlenebilir. Mevcut rolleri yeniden yazma.',
    `16. ${PROMPT_I18N.tr.personaLanguageInstruction}`,
    '17. Rol adları, görev adımları, açıklamalar ve inceleme ölçütleri Türkçe yazılmalı.',
    '',
    'Kullanılabilir hizmetler: chatgpt, gemini, claude, deepseek, grok',
    `Varsayılan hizmet: ${input.store.settings.defaultChatSite}`,
    '',
    'Beklenen JSON şeması:',
    JSON.stringify({
      flowName: 'Görev akışının adı',
      maxNodeExecutions: 30,
      roles: [{
        key: 'pm',
        reuseRoleId: 'Var olan rol kullanılacaksa kimliği; yoksa alanı çıkar',
        name: 'Ürün Yöneticisi',
        description: 'Rolün sorumluluğu',
        systemPrompt: 'Role verilecek Türkçe sistem yönergesi',
        preferredSite: 'chatgpt',
      }],
      nodes: [
        { id: 'n1', kind: 'execute', roleKeys: ['pm'], title: 'Gereksinim analizi', instruction: 'Bu adımın somut görevi' },
        { id: 'review', kind: 'review', roleKeys: ['reviewer'], title: 'Son inceleme', instruction: 'Sonucun teslim edilebilirliğini belirle', review: { criteria: 'Kabul ölçütleri', maxAttempts: 3, onMaxAttempts: 'stop' } },
      ],
      edges: [{ from: 'n1', to: 'review' }, { from: 'review', to: 'n1', branch: 'fail' }],
    }, null, 2),
    '',
    'Çalıştırılacak görev:',
    input.task,
    '',
    'Bu akış için açıklaman:',
    input.instruction?.trim() || input.task,
    '',
    'Mevcut roller:',
    JSON.stringify(input.existingRoles.map(role => ({
      id: role.id, name: role.name, description: role.description,
      systemPrompt: role.systemPrompt?.slice(0, 2000),
      site: role.modelSource === 'external'
        ? input.store.settings.externalModelsById[role.externalModelId ?? '']?.name ?? 'API'
        : role.chatSite ?? input.store.settings.defaultChatSite,
    })), null, 2),
    '',
    'Mevcut akış:',
    input.currentFlow ? JSON.stringify(input.currentFlow, null, 2) : 'Yok',
    '',
    'Önceki otomatik akış konuşmaları:',
    JSON.stringify((input.history ?? input.currentFlow?.autoPlanHistory ?? []).slice(-12), null, 2),
  ]
  return lines.join('\n')
}
