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
- [x] OpenTeam Chrome eklentisi `doctor.extension.connected=true`; UIA ve CLI doctor readback PASS (2026-10-10).
- [ ] Gerçek yerel ACP kodlama ajanı `agent list` çıktısında görünmeli; şu an daemon `agents=[]`.
- [x] Dört çekirdek rol ve Başmimar OpenTeam odasında oluşturuldu. [ ] Her rol için tam Skill içerik readback ve tool execution kapısı henüz tüm rollerle kanıtlanmadı.
- [ ] ACP bağlantısında salt-okunur Git/araç erişimi ve yetki sınırları gerçek kanıtlarla test edilmeli; hiçbir web persona otomatik dosya erişimli varsayılmamalı.
- [ ] Phase 0: RD2 mimari, ürün hedefleri, D01-D22, V1 parite ve sözleşmeleri gerçek kaynak/test/native evidence ile bağımsız denetlenmeli; feature geliştirme ancak kabulden sonra.
- [ ] Yeni build'in kurulu Chrome eklentisine kontrollü devri ve gerçek sohbet limiti E2E testi ayrı aşamada, diğer çalışan sohbetlere dokunmadan.
- [x] OpenTeam Phase 0 için 4 çekirdek rol + Başmimar JSON dosyaları hazırlandı ve beşi de canlı OpenTeam odasına eklendi.
- [x] Normal Chrome OpenTeam v1.0.3 kurulu; `agentControlEnabled=true` UIA ve CLI ile doğrulandı. Önceki başarısız CUA denemesinde hiçbir işlem yapılmamıştı.

## 2026-10-10 / OpenTeam canlı geçiş ve ilk RD2 denetimi

- [x] Kullanıcının normal Chrome profilindeki OpenTeam ayarı **Yerel ajan erişimi: Açık** yapıldı, görsel/UIA readback PASS; `openteamcli doctor` sonucu `ok=true`, `extension.connected=true`, daemon `127.0.0.1:19305`.
- [x] `chat-c7580eff-fa2e-4f09-a247-3642cfe9753d` odası oluşturuldu: Manager, EngineerA, EngineerB, IndependentReviewer, Başmimar rolü eklendi; beşi de başlangıçta `ready` idi.
- [x] Manager gerçek source erişimi iki bilinmeyen `src/windows-session-observer/index.js` satırıyla test edildi; satırlar doğrudan dosyaya karşı doğrulandı.
- [x] RD2-AUDIT-001 salt-okunur kaynak denetimi başlatıldı. EngineerB B01–B05 raporu odada `received`: native Visual Sensor/Live Viewer/Screen Control/Browser adapter eksik, gerçek latency/FPS NOT_VERIFIED. En az dört kaynağın başlığını doğrudan readback ile doğruladık.
- [ ] EngineerA gerçek ChatGPT kaynak sohbetinde son raporu üretti; **OpenTeam ikinci mesaj için yanlış `send was not acknowledged` hata durumu yazdı. Yeniden GÖNDERME — önce mevcut gerçek yanıtı senkronize et!** Kaynak sohbet /c/6aca1ba0-2850-83eb-ad29-282fb3d7c105.
- [ ] Manager cevap yakalama error `response_not_found`, EngineerB ikinci mesaj sonucu hata gösteriyor; önce kaynak sohbetleri karşılaştır, otomatik retry yok. `src/teamPage/messagesView.ts:227-233` error durumunda `retryRoleReply` kullanıyor: bu yanıtın yeni gönderimle tekrar işlenme riskidir. Salt readback/resync tercih edilmeli.
- [x] IndependentReviewer salt-okunur karşı inceleme sonucu `REWORK` verdi; testler yeniden çalıştırılmadı, native E2E NOT_RUN ve Phase 0 FULL ACCEPTED değil. Ön rapor `docs/RD2_PHASE0_PRELIMINARY_AUDIT_20261010.md`.
- [ ] Daemon ACP listesi hâlâ `agents=[]`: browser role ChatGPT araç erişimi ile ayrı native/local ACP kodlama ajanı bağlantısı farklıdır; gerçek kodlama için ayrıca sağlam yetki ve araç testi gerekli.
- [ ] İlk Phase 0 denetiminin gerçek tamamlanma koşulu: A+B+Başmimar raporları ve IndependentReviewer kod/satır kanıtı, P0–P3 onayı, kod değişikliği olmadan TODO/GLOBALMEMORY eşleşmesi.

## 2026-10-10 / RD2-AUDIT-002 işçi ve yönetici görev dağıtımı

- [x] Mevcut OpenTeam Phase0 odası yeniden kullanıldı, yeni sohbet/rol/worktree açılmadı. Oda: `chat-c7580eff-fa2e-4f09-a247-3642cfe9753d`.
- [x] `Manager`: RD2-PHASE0-MANAGER-002 — ilk kaynak bulgularını D01–D22/roadmap kabul matrisine dönüştürme ve Reviewer kapısı. **İletildi; teslim/kanıt bekleniyor**.
- [x] `EngineerA`: RD2-AUDIT-002A — D01–D11, V1 F01–F28 hedef/contract/test kaynak matrisi. OpenTeam msg `msg-e126a6e4-d853-4722-b0e5-5474de57d1c4`. **İletildi; teslim bekleniyor**.
- [x] `EngineerB`: RD2-AUDIT-002B — D12–D22, V1 F29–F57 / X01–X03 hedef/contract/test kaynak matrisi. OpenTeam msg `msg-c58d49ab-887b-4046-b417-5752cc2a928d`. **İletildi; teslim bekleniyor**.
- [ ] A+B+Manager son raporları `task.read` ile `received` ve gerçek dosya:satır doğrulanmadan `IndependentReviewer` son kapsam kabulü yok.
- [x] Hata durumundaki assistant yanıtına `yeniden gönder` yerine açık `kaynak yanıtı senkronize et` eylemi bağlandı; bu eylem eski isteği **tekrar göndermiyor**. `src/teamPage/messagesView.ts` ve unit test değişti.
- [x] `npm run verify` EXIT0: TypeScript PASS, Vitest `711/711` PASS (85 dosya), Vite build PASS. Native/gerçek Chrome reload E2E **henüz yapılmadı**.
- [ ] Kurulu Chrome uzantısının yeni build'e kontrollü geçişi; aktif Manager/A/B denetim yanıtları tamamlanmadan yeniden yükleme YOK.
- [x] Canlı hata kök nedeni: ChatGPT Türkçe `Durdur` üretim düğmesi `src/content/sites/chatgpt.ts` regex'inde yoktu; eklendi. Gönderim sonrası yeni kullanıcı turn'u henüz görünmese de görünür `Durdur` ile ACK kabulünü test eden regresyon eklendi. `npm run verify`: 712/712 test PASS, typecheck+build doğrulanınca bu kaydı sonlandır.
- [ ] Hata sonrası kaynak yanıtı yanlış mesaja bağlanmama/late-reply resync, kurulu Chrome eklentisine yeni derlemenin kontrollü geçirilmesi ve gerçek site E2E hâlâ gerekli. `agent.list=[]` olduğu için yerel ACP kod işçisi hazır değil; browser rolü MCP okumaları ACP değildir.

## 2026-10-10 / Devam — yanıt yakalama ikinci güvenlik düzeltmesi

- [x] Türkçe ChatGPT `Durdur` generation/ACK eksikliği kapatıldı; sentetik test ve `npm run verify` 712/712 PASS; commit `550b9b2`.
- [x] `GROUP_MESSAGE_RESYNC_REPLY` ve `TEAM_ROLE_REPLY_RESYNC` artık aynı role sonradan gönderilmiş görev veya daha yeni yanıt varsa eski assistant metnini güncellemeyi reddediyor. Negatif test `src/background/groupExperience.test.ts` eklendi.
- [ ] Final source/test changes için tam verify, commit ve canlı kontrollü extension reload/readback tamamlanmadan production ACCEPTED değil.
- [x] `RD2-PHASE0-MANAGER-002` gerçek 5245-karakterlik beş satırlı ürün/sözleşme/test risk matrisi teslim etti; kaynak satırları + `REWORK` kararı.
- [ ] EngineerA D01-D11 genişletme gönderimi `send was not acknowledged` ile ERROR; kaynak ChatGPT'yi tekrar göndermeden doğrula. EngineerB D12-D22 yanıtı yalnız niyet; yeni Reviewer D01-D22 görevi yalnız niyet. Bunlar tamamlanmış sayılmıyor.
- [ ] Local ACP `agent.list=[]`, gerçek kodlama işçileri/yerel run yetkileri yapılandırılmalı. Bu bir browser-MCP danışman rolünün kaynak okumasından farklıdır.
