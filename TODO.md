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

## 2026-10-10 / RemoteDesktop V2 geçiş kapısı

- [x] RD2 main/origin/main temiz, eski A/B/C/V branch ve worktree kaldırılmış; eski işçi sekmeleri kapalı (Git + Chrome doğrulandı).
- [x] Windows'ta OpenTeam CLI daemon ana modül algılaması düzeltildi; yerel servis 127.0.0.1:19305 üzerinde `daemon start` PASS.
- [ ] OpenTeam Chrome eklentisi `doctor.extension.connected=true` gösterecek şekilde güvenli bağlanmalı; şu an false.
- [ ] Gerçek yerel ACP kodlama ajanı `agent list` çıktısında görünmeli; şu an daemon `agents=[]`.
- [ ] Dört kalıcı rol (Manager, Engineer A/B, Independent Reviewer) ve salt-okunur Phase 0 audit için Başmimar rolü oluşturulup Skill readback testi yapılmalı.
- [ ] ACP bağlantısında salt-okunur Git/araç erişimi ve yetki sınırları gerçek kanıtlarla test edilmeli; hiçbir web persona otomatik dosya erişimli varsayılmamalı.
- [ ] Phase 0: RD2 mimari, ürün hedefleri, D01-D22, V1 parite ve sözleşmeleri gerçek kaynak/test/native evidence ile bağımsız denetlenmeli; feature geliştirme ancak kabulden sonra.
- [ ] Yeni build'in kurulu Chrome eklentisine kontrollü devri ve gerçek sohbet limiti E2E testi ayrı aşamada, diğer çalışan sohbetlere dokunmadan.
- [x] OpenTeam Phase 0 için 4 çekirdek rol + gerektiğinde Başmimar; CLI'ye uygun JSON dosyaları `docs/RD2_OPENTEAM_CORE_ROLES.json` ve `docs/RD2_OPENTEAM_OPTIONAL_ARCHITECT.json` içinde hazırlandı. (Henüz eklentide kayıtlı değiller.)
- [ ] Normal Chrome OpenTeam v1.0.3 kurulu, fakat `agentControlEnabled=false`; GUI'de Ayarlar > Yerel ajan kontrolü etkinleştirme gerekli. Sınırlı CUA denemesi güvenli biçimde FAIL oldu, eylem yapılmadı.
