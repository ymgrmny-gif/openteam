# OpenTeam Local Evaluation — TODO

## 2026-10-10 / Otomatik sohbet devri ve kurtarma

- [x] Ayrı `feat/openteam-chat-handoff-20261010` branch ve mevcut çalışma dosyalarını koruma.
- [x] ChatGPT sohbet uzunluğu limiti / hesap kullanım kotasını ayrı algılama.
- [x] OpenTeam rol kimliğini ve son kayıtlı bağlamı koruyarak yeni sohbet bağlantısı oluşturma.
- [x] Aktif/belirsiz görevlerin otomatik tekrarlanmasını engelleme, tekrar denemeyi limitte durdurma.
- [x] Yeni sohbet kimliği + tam `HAZIR_DEVIR` cevabını doğrulayan kabul kapısı.
- [x] Başarısızlık/timeout durumlarını fail-closed olarak işaretleme.
- [x] Birim ve sentetik entegrasyon testleri, TypeScript kontrolü, Vite build.
- [ ] **Canlı iki ChatGPT test sohbetinde** limit/yeniden sohbet devri uçtan uca kabul testi (henüz yapılmadı; RD2 işçi sohbetleri kullanılmayacak).
- [ ] ACP/gerçek kodlama ajanı + proje Git kanıtıyla gerçek işçi devri kabul testi (ayrı onay/izin ve scope gerekli).
- [ ] Kullanıcının sahip olduğu uzak bir Git deposu belirlenip kaynak yedeklemesi; upstream `afumu/openteam` deposuna izinsiz push yapılmayacak.
- [ ] Kurulu Chrome uzantısı yeni build ile ancak kontrollü doğrulama sonrasında değiştirilir.

## RD2 etkisi

RemoteDesktop V2 kodu/V1/üretim/gerçek OS oturumları değiştirilmedi.
Bu OpenTeam özelliği RD2-004A işçi kapanış ve mimari denetim kapılarının yerine geçmez.
