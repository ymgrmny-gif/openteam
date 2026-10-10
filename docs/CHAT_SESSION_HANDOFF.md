# OpenTeam — Sohbet Limiti ve Güvenli Görev Devri

## Kapsam
- Chrome üzerinde OpenTeam'e bağlı **ChatGPT web rolü** için açıkça görünen sohbet uzunluğu sınırı uyarısını algılar.
- Aynı OpenTeam `chatId` ve `roleId` korunur; yalnız site konuşması değiştirilir.
- Eski site konuşmasının bağlantısı, bounded son rol bağlamı ve OpenTeam mesaj sırası yerel kalıcı grup deposundaki `conversationHandoff` alanına kaydedilir.
- Yeni site konuşması açılır, rolün sistem talimatı ve önceki bağlamı **eylem içermeyen** bir devir mesajıyla iletilir.
- Devir tamamlandı sayılmadan önce farklı ChatGPT konuşma ID'si ve aynı initialization mesajına cevap olarak **tam `HAZIR_DEVIR`** onayı aranır.
- Yeni role normal işler ancak `verified` durumundan sonra gönderilir.
- Yerel kodlama işçisinin aynı `task_id`, branch/worktree/commit durumunu **Git/TODO/GlobalMemory üzerinden ayrıca doğrulaması** zorunludur.

## Koruyucu sınırlar
- ChatGPT hesap/model kullanım kotası `ACCOUNT_QUOTA` ayrı sınıflandırılır; yeni sohbet açılmaz ve kota etrafından dolaşılmaz.
- Belirsiz/gönderilmiş fakat yanıtı doğrulanmamış prompt, aktif görev, bloke rol veya aynı anda yürüyen ikinci devir **otomatik yeniden yürütülmez**. İlgili rol açıkça BLOKLU kalır.
- Devir hatasında eski konuşma geçmişi ve OpenTeam rol kimliği silinmez; geri dönüş için kayıt kalır.
- Tek aktif OpenTeam sayfa kilidi korunur. Rol kurtarma aynı anda iki defa tetiklenmez.
- Sistem yeniden açıldığında `rotating` aşamasındaki devir yeniden başlatılabilir; `initializing` aşamasında eski initialization promptu tekrar gönderilmez.
- Onay başarısızlığı, desteklenmeyen servis, site login sorunu ve iki dakikalık timeout fail-closed olarak raporlanır.
- Bu mekanizma **RemoteDesktopV2 çalıştırma çekirdeğine, V1 üretimine veya gerçek Windows bilgisayar kontrolüne bağımlılık eklemez.**

## Bilinen sınırlar
- ChatGPT'nin görünen uyarı DOM'una dayanır; site tasarımı değişirse yeni bir DOM fixture/test gerekir.
- Gerçek bir ChatGPT hesabının doğal sohbet limitini zorlamak amacıyla işlem yapılmadı; canlı iki sohbet arasında geçiş testi henüz kanıtlanmadı.
- Hesap kotası, kimlik doğrulama sorunu ve bağlı olmayan yerel kodlama ajanı sohbet değiştirerek çözülemez.
- Önceden gönderilmiş bir gerçek kodlama komutunun güvenli tekrarını otomatik tahmin etmez. Belirsizlikte durup yöneticinin yerel Git/işçi kayıtlarını uzlaştırmasını ister.
- Sadece seçili OpenTeam odasında barındırılan roller izlenir; farklı hesap/sites için ayrıca adaptör uygulaması ve test gerekir.

## Kabul/test komutları
```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

Testler: `src/group/chatSessionHandoff.test.ts`, `src/teamPage/chatSessionHandoffController.test.ts`, `src/background/chatSessionHandoffRoutes.test.ts`, mevcut role ve ChatGPT adapter testleri.

**Canlı etkinleştirme:** `dist` oluşturmak eklentiyi açık Chrome profilinde yeniden yüklemez. Gerçek site üzerinde geçiş yalnız önceden oluşturulmuş, salt sentetik/test OpenTeam sohbetleriyle ayrıca doğrulanmalıdır; RemoteDesktop V2 işçi sohbetleri test için kullanılmaz.
