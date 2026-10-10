// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { defaultLanguageForEnvironment, localizeCategory, localizeGroupTemplate, localizeRoleTemplate, normalizeLanguage, translateUi } from './i18n'
import { TURKISH_UI_TRANSLATIONS } from './i18n.tr'
import { TURKISH_MESSAGES } from './i18n.tr.messages'
import { applyTeamLanguage } from '../teamPage/languageController'

describe('OpenTeam Türkçe arayüz kabulü', () => {
  it('Turkish is the default, while saved English/Chinese remain selectable', () => {
    expect(normalizeLanguage(undefined)).toBe('tr')
    expect(defaultLanguageForEnvironment({ language: 'de-DE', languages: ['de-DE'] })).toBe('tr')
    expect(normalizeLanguage('en')).toBe('en')
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN')
  })

  it('uses natural Turkish in core navigation and user-facing warnings', () => {
    expect(translateUi('群聊', 'tr')).toBe('Sohbetler')
    expect(translateUi('编排', 'tr')).toBe('Görev akışı')
    expect(translateUi('添加人员', 'tr')).toContain('ekle')
    expect(translateUi('编排已完成', 'tr')).toContain('tamamlandı')
    expect(translateUi('⚠️ 未检测到回复，可能是 AI 响应过慢或 DOM 结构已变更。', 'tr')).toContain('Yanıt')
    expect(translateUi('删除群聊失败', 'tr')).toBe('Sohbet silinemedi')
    expect(translateUi('9 个群聊 · 311 个人员库人员', 'tr')).toBe('9 sohbet · 311 kayıtlı rol')
    expect(translateUi('成员 2', 'tr')).toMatch(/2/)
  })

  it('provides translated labels, hints and placeholders without modifying message contents', () => {
    document.body.innerHTML = `
      <button aria-label="设置">⚙</button>
      <p>未选择群聊</p>
      <textarea placeholder="输入消息，@成员可指定回复；不 @ 仅记录到群聊。"></textarea>
      <div class="message-body">Original assistant response from the model</div>
    `
    applyTeamLanguage('tr')
    expect(document.documentElement.lang).toBe('tr')
    expect(document.querySelector('button')?.getAttribute('aria-label')).toBe('Ayarlar')
    expect(document.querySelector('p')?.textContent).toBe('Sohbet seçilmedi')
    expect(document.querySelector('textarea')?.placeholder).toContain('Mesaj')
    expect(document.querySelector('.message-body')?.textContent).toBe('Original assistant response from the model')
  })

  it('does not contain untranslated Han characters in curated interface dictionaries', () => {
    for (const [key, value] of Object.entries({ ...TURKISH_UI_TRANSLATIONS, ...TURKISH_MESSAGES })) {
      expect(value, key).not.toMatch(/[\u3400-\u9fff]/)
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('translates team categories and task-oriented role templates', () => {
    expect(localizeCategory('技术研发', 'tr')).toBe('Yazılım ve teknoloji')
    const role = localizeRoleTemplate({
      id: 'default-custom-engineer',
      type: 'custom',
      name: 'Engineer',
      description: 'Focuses on implementation.',
      systemPrompt: 'Respond in English.',
      createdAt: 0, updatedAt: 0,
    }, 'tr')
    expect(role.name).toContain('Mühendisi')
    expect(role.systemPrompt).toContain('Türkçe')
    expect(role.systemPrompt).not.toContain('Respond in English')
  })

  it('localizes a built-in group and its roles without changing identity', () => {
    const source = {
      id: 'software-development', name: '软件开发群', category: '技术研发',
      summary: '开发应用', userTypes: ['程序员'], aliases: ['app'], suggestedQuestions: ['开发什么'],
      riskLevel: 'normal' as const, defaultChatName: '软件开发群', defaultMode: 'collaborative' as const,
      roles: [{ name: '工程师', description: '负责开发', systemPrompt: '请用中文回答' }],
    }
    const group = localizeGroupTemplate(source, 'tr')
    expect(group.name).toBe('Yazılım Geliştirme Ekibi')
    expect(group.category).toBe('Yazılım ve teknoloji')
    expect(group.roles[0]?.name).toBe('Yazılım Mühendisi')
    expect(group.roles[0]?.systemPrompt).toContain('Türkçe')
  })
})
