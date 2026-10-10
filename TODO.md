# OpenTeam Local Evaluation — TODO

## 2026-10-10 / Manager sonlu proje döngüsü

- [x] Tek `task.post` ile kayıtlı orchestration run arasındaki eksik backlog/otomatik devam sınırı kodda doğrulandı.
- [x] Mevcut FSM üzerinde `project.start/read/pause/resume`, Manager → tek sahipli Engineer → IndependentReviewer → sonraki görev zinciri uygulandı.
- [x] REWORK aynı işe dönüyor; bağımsız kaynak/teslim kimliği + evidence kapısı, sonlu deneme bütçesi, mantıksal branch/worktree sahipliği ve çapraz oda çakışma engeli eklendi.
- [x] Kalıcı geçiş kuyruğu, immutable flow snapshot, startup/alarm recovery, iki crash checkpoint regresyonu, duplicate/stale response koruması ve belirsiz gönderimi yeniden göndermeme eklendi.
- [x] Pause devam eden dış aracı iptal etmeden kaynak kimliğini koruyor; resume orijinal yanıtı kullanıyor. Blocked durumunda açıklama ve manuel kaynak uzlaştırması gerekiyor.
- [ ] Canlı Chrome extension reload + iki gerçek işli proje E2E + canlı reload-resume kabulü: **BLOCKED**, Chrome browser bağlantısı yok; kurulu uzantıda yeni project capabilities henüz yok. Sentetik testler canlı kabul değildir.
- [ ] RD2 sonlu backlog/kabul ölçütleri kullanıcı tarafından verilerek yeni girişten başlatılmalı; eski smoke mesajları izin/backlog yerine kullanılmaz. Tarihi pending prompt yeniden gönderilmedi.
- [x] Handoff ve uygulama sınırları: `docs/MANAGER_PROJECT_LOOP.md`. Upstream push/merge ve RemoteDesktopV2 değişikliği yok.
- [x] Nihai `npm run verify` EXIT0: TypeScript PASS, Vitest **736/736** (86 dosya) PASS, Vite production build PASS. Sandbox localhost EACCES nedeniyle tam testler localhost erişimi açık çalıştırıldı.

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

## 2026-10-10 / RD2 görev kurtarma son kapısı

- [x] Reviewer RD2-AUDIT-002V final raporu 3.941 karakter, aynı OpenTeam error yanıtında yeni prompt göndermeden kaynak resync ile kurtarıldı; REWORK.
- [x] Kaynak kurtarma `received` olunca eski görev delivery `error` kalıyordu; yeni `TEAM_ROLE_REPLY_RESYNC` kaynak kullanıcı teslim ve rol durumunu `received`/`ready` olarak düzeltir. Pozitif/negatif testler PASS.
- [x] `npm run verify` EXIT0: TypeScript, Vitest 714/714 (85 dosya), Vite build PASS.
- [ ] Son derlemenin Chrome extension reload ve veri/rol readback kapısı.
- [ ] ACP `agent.list=[]` ve tam RD2 D01-D22/V1 parite native E2E kabulü açık; mevcut rapor REWORK, RD2 source değişmedi.

## 2026-10-10 / Gerçek OpenTeam browser işçi/manager smoke — teslim

- [x] Normal Chrome OpenTeam `Reload` ile son build yüklendi; `doctor.ok=true`, extension.connected=true, oda/5 rol/31+ mesaj korundu.
- [x] EngineerA POST-RELOAD-A3 `msg-79e99f51-4ef7-4fa4-855b-6db51e905bec`: task.read RECEIVED, gerçek support authorization index.js:1-8 ve `NOT_IMPLEMENTED` kanıtı.
- [x] EngineerB POST-RELOAD-B3 `msg-78a911c8-35da-40ea-9666-b9c982c2393d`: task.read RECEIVED, screen-control-target/index.js:8 & browser-adapter-contract/index.js:5, `NOT_IMPLEMENTED`.
- [x] Manager POST-RELOAD-MANAGER `msg-4b53e587-0e6a-450e-845a-a543842c93d6`: task.read RECEIVED, sözleşmeleri koru/P0 native aktarım/Reviewer kabul kapısı sonucu, NO-GO kodlama.
- [x] Bağımsız Reviewer `RD2-AUDIT-002V` 3941 karakterlik FINAL REWORK cevabı kaynak readback/resync ile prompt resend olmadan kurtarıldı; üst denetim henüz tam ACCEPTED değil.
- [x] Geçiş raporu: `docs/RD2_OPENTEAM_CUTOVER_ACCEPTANCE_20261010.md`.
- [ ] Web browser rollerinin okuma+sohbet smoke testi ACCEPTED_SCOPED; ACP `agent.list=[]` ve tam native RD2 Phase0 audit/üretim kodlama yetkisi HENÜZ kabul edilmedi. Yeni feature koduna geçme.

## 2026-10-10 / GPT geliştiricilere doğrudan araç yetkisi

- [x] Ayrı ACP modeline bağımlı kalmadan mevcut ChatGPT hesap/RemoteDesktop MCP araçlarıyla geliştirme yaklaşımı seçildi; bağlanan her araç için gerçekten mevcut erişim kanıtı gerekiyor.
- [x] Mevcut Phase0 salt-okunur denetim odası korunarak yeni `RD2 / GPT Geliştirme Ekibi` odası oluşturuldu (`chat-a7afea7b-0f97-494d-a6ef-33e3c1c5168d`): Manager, EngineerA, EngineerB, IndependentReviewer; 4 rol `ready`.
- [x] Rollere terminal/dosya yazma/Git/test/diğer bağlı araçları kullanabilecek geliştirme talimatları verildi (`docs/RD2_OPENTEAM_GPT_DEVELOPMENT_ROLES.json`). Yapay zekâlar yine GPT, ayrı ACP AI ajanı şart değil.
- [x] Yalnız izole `E:\\Projects\\RD2_Work\\OpenTeamGPTToolSmoke_20261010` alanı oluşturuldu; RD2 `main` ve OpenTeam kodu değiştirilmedi.
- [ ] EngineerA'nın `OPENTEAM-GPT-CODE-SMOKE-001` gerçek write+node test+git init+readback görevi gönderildi, ilk kontrol sırasında `pending`, no files yet. **Kesin PASS verilmedi, yeniden göndermeyin**; message `msg-07cb3ac3-bd2f-4fb7-8eb8-52603a09f87b` üzerinden task.read ile takip edin.
- [ ] Kanıtlı write/test/Git PASS sonrası Manager ve IndependentReviewer aracılığıyla bu geliştirme odasına gerçek güvenli geliştirme görevleri atansın; Phase0 REWORK/native OS gate korunur.

## 2026-10-10 / OpenTeam Chrome Out of Memory — canlı teşhis

- [x] Kullanıcının ekranındaki OpenTeam sekmesinde `Not enough memory to open this page` / `Error code: Out of Memory` doğrulandı (Visual Sensor/UIA).
- [x] Sistem genelinde 31.84 GB RAM, ~15.97 GB boş RAM. Chrome'da bir OpenTeam sekmesi ~2.3 GB, bir diğeri ~1.2 GB gösteriliyordu; OOM büyük olasılıkla renderer/iframe kaynak tüketimi, toplam PC RAM yetersizliği kanıtlanmadı.
- [x] İki çökmüş OpenTeam sekmesi doğrudan yalnız o sekmelerde Ctrl+W ile kapatıldı; çalışan OpenTeam sekmesi, görev ve roller korundu. Son aktif UI OOM göstermiyor.
- [ ] Sadece açık tek OpenTeam odasıyla kontrollü bellek ölçümü + iframe mount/unmount/primary-lifecycle yük testi; tab başına tüketim ve Chrome OOM kök nedeni doğrulanıp düzeltilecek.
- [ ] EngineerA `msg-07cb3ac3-bd2f-4fb7-8eb8-52603a09f87b` hâlâ `pending`, rol reload sonrası `ready`, sandbox boş. Eski promptu yeniden gönderme; kaynak sohbet/dispatch kanıtı incele, gerekiyorsa explicit failed/cancel reconciliation sonrası yeni kontrollü tek işçi denemesi yap.

## 2026-10-10 / GPT yazılım ekibi canlı kabulü — PASS_SCOPED

- [x] OpenTeam Chrome OOM yeniden üretildi; iki çökmüş kopya sekme kapatıldı, aktif oda korundu.
- [x] Eski oda iframe'leri boşta kalınca unload ediliyor; aktif işler ve 10 dakikadan yeni pending/sent teslimler korunuyor. Tarihi eski pending teslimler renderer tutmuyor. 716/716 Vitest + TS/build PASS.
- [x] GPT EngineerA gerçek write/read/test/Git commit PASS; `hello.mjs`, `hello.test.mjs`, Node 2/2 exit0, sandbox commit `4b2da0fd359b0659ebc16b698b7de612b344d149`.
- [x] GPT EngineerB ayrı sandbox gerçek write/read/test/Git init PASS; `slug.mjs`, `slug.test.mjs`, Node 2/2 exit0. Commit istenmedi.
- [x] GPT Manager dosyaları/testleri bağımsız doğruladı; `PASS_SCOPED`, teslim `received`.
- [x] GPT IndependentReviewer kaynak, test, Git, sınır/negatif koşulları bağımsız doğruladı; `PASS_SCOPED`, teslim `received`.
- [x] Kanıt raporu: `docs/OPENTEAM_GPT_WORKFORCE_ACCEPTANCE_20261010.md`.
- [ ] Tarihi `msg-07cb3ac3-bd2f-4fb7-8eb8-52603a09f87b` task `pending` ledger temizlenmeli, YENİDEN GÖNDERİLMEMELİ. Bu kayıt yeni görevleri engellemiyor.
- [ ] RD2 Phase0 D01–D22/V1 parite ve native Windows E2E bağımsız kabulü hâlâ `REWORK`; RD2 main değiştirilmedi.

## 2026-10-10 / Proje → görev → aşama ve otomatik ilerleme

- [x] TODO snapshot içe aktarma: başlıklar, alt görevler, bağımlılıklar, ağırlıklar ve izin kapıları; tarihî [x] işaretleri doğrulanmış kabul sayılmaz.
- [x] Manager plan-only yanıtıyla 1..8 sonlu aşama; tek-yazar sahipliği korunur, son aşama ana işin bütünleşik kabulünü doğrular.
- [x] Engineer → IndependentReviewer PASS/REWORK; kabul sonrası otomatik sonraki aşama/iş; tüm sonlu backlog kabul edilince completed.
- [x] Kalıcı checkpoint/lease ve özgün kaynak yanıtıyla pause/resume; reload sentetik regresyonunda duplicate-send yok. Blocked sebebi ve izin sınırı korunur.
- [x] Proje paneli: açılır görev/aşama ağacı, kabul/açık sayısı, ağırlıklı ilerleme, sahip, kabul koşulları, kanıt ve geçmiş; CLI import/execute/read/pause/resume.
- [x] Yeni ve mevcut çalışma kapsamları için ayrı kaynak/rol/worktree sahipliği; açık projenin kaynak geçmişi ve rol kimliği silinemez.
- [x] Teknik teslim ve kullanım: docs/PROJECT_WORKSPACE_HANDOFF.md. RD2 ana depoya dokunulmadı; upstream push/merge yok.
- [ ] LIVE NOT_RUN: doctor PASS fakat yüklü extension yeni project.import/execute/workspacePause/workspaceResume yeteneklerini henüz bildirmiyor. Yeni build yüklenip gerçek Manager→Engineer→Reviewer→sonraki iş ve reload-resume kabulü yapılmalı. Sentetik testler canlı kabul değildir.
- [ ] TODO disk izleme/writeback ve değişen TODO'nun eski kabul kayıtlarıyla birleştirilmesi bu sürümde yok; snapshot kaynak korunur.
- [x] Son doğrulama: npm run verify exit 0; TypeScript PASS, Vitest 750/750 (89 dosya) PASS, build PASS; git diff --check PASS.
