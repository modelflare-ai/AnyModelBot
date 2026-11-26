# Veriler ve gizlilik

[简体中文](./privacy.md) | [繁體中文（台灣）](./privacy_zh-TW.md) | [English](./privacy_en.md) | [日本語](./privacy_ja.md) | [한국어](./privacy_ko.md) | [Русский](./privacy_ru.md) | [Español](./privacy_es.md) | [Português (Brasil)](./privacy_pt.md) | Türkçe

**Tek cümlede:** sohbetler, bellek, dosyalar ve anahtarlar cihazında durur; bir modele gönderdiğin her şey, seçtiğin model sağlayıcısına gider — kendi resmi API anahtarınla doğrudan, yoksa Modelflare üzerinden. Verilerinin her riskin ötesinde olduğunu söylemiyoruz: bir modele giden her şey cihazından çıkar.

Bu belge AnyModelBot'un neyi nerede tuttuğunu, cihazından neyin çıktığını ve nasıl sileceğini anlatır. Sorular: [support@anymodel.bot](mailto:support@anymodel.bot).

## Veri klasörü

| Nasıl çalıştırırsın | Veri klasörü |
| :--- | :--- |
| Masaüstü · Windows | `%APPDATA%\anymodel bot\data` |
| Masaüstü · macOS | `~/Library/Application Support/anymodel bot/data` |
| Masaüstü · Linux | `~/.config/anymodel bot/data` |
| Komut satırı `npm start` | `./data` (`AMB_DATA_DIR` ile değiştir) |
| Docker | Kapsayıcıda `/data` (README örneğinde `amb-data` birimi olarak bağlanır) |

## Veri envanteri

| Veri | Nerede durur (veri klasörünün içinde) | Cihazdan çıkar mı? | Nereye gider |
| :--- | :--- | :--- | :--- |
| Sohbetler ve oturumlar | `anymodel.db` (SQLite) | Bir yanıtın gerek duyduğu kısım | Seçtiğin sağlayıcıya, Modelflare üzerinden model bağlamı olarak gönderilir |
| İçe aktarılan beceriler | `skills/<bot ID>/`; açık kopyalar `dsh/<bot ID>/skills/` içinde | Kullanım sırasında yüklenen adlar, açıklamalar ve içerik çıkar | Seçilen modelin bağlamı; içe aktarma yalnızca senin AnyModelBot örneğine yüklenir ve GitHub'a bağlanmaz |
| Sohbet arama dizini | `anymodel.db` içindeki `message_search` ve tam metin dizini | Hayır | Kayıtlı mesajları örnek içinde, model çağrısı olmadan arar |
| Bellek | `memory/` (Markdown: `bots/`, `groups/`; Hakkımda: `about-me.json`, 30 günlük değişiklik geçmişiyle; `team/` yükseltmeden önceki ekip belleğidir, Hakkımda'ya taşınmıştır ve artık okunmaz) | Kullanıldığında | Model isteklerine bağlam olarak eklenir; gizli bilgiye benzeyen her şey yazılmadan önce süzülür, kimlik ve banka kartı numaraları hiç kaydedilmez, adresler, telefon numaraları ve e-postalar yalnızca sen onayladıktan sonra Hakkımda'ya girer |
| Bot çalışma alanı dosyaları | `workspaces/<bot>/` (`inbox/` içindeki alınan dosyalar ile `media/` içindeki üretilen görüntü ve video dahil) | Bir bot onları okuyup bir modele gönderdiğinde | Yukarıdakiyle aynı |
| Mesaj ekleri | `attachments/` (sohbete yapıştırdığınız görsellerin ve sürüklediğiniz görsel ile metin dosyalarının kopyaları; dosya adları rastgeledir, görseller EXIF ve diğer üst veriler olmadan saklanır). Gönderilmeyenler en fazla 24 saat, gönderilenler 30 gün tutulur, sonra silinir | Mesajı gönderdiğinizde | Görseller ve dosyaların tam metni o mesajla birlikte model isteği olarak seçtiğiniz sağlayıcıya gider; yerel kopyayı silmek gönderilmiş içeriği geri almaz |
| Modelflare oturum bilgisi | `modelflare-account.json` (kip 600) | Yalnızca belirteç yenilenirken modelflare.dev'e | Modelflare |
| API anahtarı | `magpie/config/` içindeki ağ geçidinin yalıtılmış yapılandırması | Modelflare'e giden her model isteğinde kimlik doğrulama olarak | Modelflare |
| Resmi API anahtarı (eklersen) | `magpie/config/` içindeki ağ geçidinin yalıtılmış yapılandırması | O sağlayıcıya giden her model isteğinde kimlik doğrulama olarak | O model sağlayıcısı |
| WeChat oturum durumu ve eşitleme imleci | Veri klasörünün içinde (`weixin/` ve diğerleri) | WeChat iLink API'siyle konuşurken | Tencent WeChat |
| Feishu sohbet hesaplarının App ID / Secret değerleri | `anymodel.db` | Feishu Open Platform'a uzun bağlantı açılırken | Feishu |
| Telegram, Slack ve Discord belirteçleri | `anymodel.db` | O platformla konuşurken | Bağladığın platform |
| İzin listesi ve erişim istekleri | `anymodel.db`: hangi kanal hesabını kimin kullanabileceği ve bir yabancının gönderdiği ilk mesaj (kısaltılmış, kim olduğunu anlayasın diye) | Hayır | — |
| Gönderilmeyi bekleyen yanıtlar | `anymodel.db` giden kutusu: gönderilmemiş mesaj içeriği ve nedeni; kişi yeniden yazana kadar tutulan WeChat mesajları dahil (en çok 7 gün tutulur; gönderilenler 7 gün sonra, iletilemeyenler 30 gün sonra silinir) | Gönderildiklerinde | WeChat / Feishu |
| Arka plan görevleri ve kurallar | `anymodel.db` (görevler, kurallar ve çalışma günlükleri, 30 gün tutulur); `workspaces/<bot>/tasks/` içindeki görev klasörleri, 30 gün kullanılmazsa silinir (önce Seni bekliyor içinde söylenir); oturum dosyaları `dsh/<bot>/sessions/` içinde, görevle birlikte silinir | Çalışırken | Sohbetlerdeki gibi: model isteklerinde bağlam, Modelflare üzerinden seçtiğin sağlayıcıya gönderilir |
| Ayarlar | `config.json` | Hayır | — |
| Günlükler | `logs/app.log` (boyuta göre döner) | Varsayılan olarak hayır; “Tanıyı kopyala” elle kopyaladığın bir şeydir, anahtarlar `***` ile değiştirilir. Yalnızca İstekler ve Geri Bildirim'de Sorun bildir altında “Çalışma durumunu ve son günlükleri ekle”yi seçip gönderirsen son 120 satır (anahtarlar değiştirilmiş) o gönderimle gider | Modelflare'deki gizli talebin (yalnızca gönderdiğinde) |
| Bağlı uygulamaların kimlik bilgileri (yalnızca bağlarsan): oturum belirteçleri, yapıştırılan belirteçler ve anahtarlar, ayrılmış URL'ler ve özel MCP bağlayıcılarının üst bilgileri / sorgu parametreleri / ortam değişkenleri | `app-secrets.json` (izin 600, veritabanının dışında); günlüklerde, tanılarda ve arayüzde maskelenir | Bir bot her okuduğunda veya yazdığında o hizmete kimlik doğrulama olarak gönderilir; yerel bir komutun ortam değişkenleri yalnızca eklediğin yerel programa gider | Bağladığın uygulamalar (Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva) veya eklediğin özel MCP sunucuları |
| Bağlantıların adları, adresleri, durumu ve araç listeleri | `anymodel.db` (anahtar içeren ayrılmış URL'ler ve adresler maskelenmiş tutulur) | Hayır | — |
| Bir botun bağlı uygulamalardan okuduğu içerik (belgeler, mesajlar, issue'lar…) | Ayrı tutulmaz; bir sohbete girince o sohbetle birlikte tutulur | Evet | Model isteklerinde bağlam olarak, Modelflare üzerinden seçtiğin sağlayıcıya gönderilir |
| Ekran görüntüleri (bilgisayar kullanımı) | Uzun süre tutulmaz | Evet | Model isteğinin parçası olarak Modelflare üzerinden görme yeteneği olan bir modele gönderilir; dosya olarak istemedikçe WeChat veya Feishu sohbetlerine iletilmez |

## Yerel konsol erişim denetimi

- Konsol varsayılan olarak `127.0.0.1:3600` üzerinde dinler ve ağından veya internetten erişilemez.
- Masaüstü uygulaması her açılışta rastgele bir erişim belirteci üretir, böylece başka yerel programlar yönetim API'sini doğrudan çağıramaz.
- Konsol API'si geri döngü adresinde de her zaman erişim belirteci ister. Masaüstü uygulaması belirtecini yalnızca bellekte tutar; komut satırı sürümü ve Docker, yapılandırılmış bir belirteç yoksa bir tane üretir ve veri klasöründeki `ui-token` dosyasında saklar (Docker: `docker exec amb cat /data/ui-token`). Terminalden başlatılan komut satırı sürümü belirteçli adresi bir kez yazdırır.
- 3600 portunu doğrudan internete açma. Uzaktan erişim için kendi denetlediğin bir VPN'in veya kimlik doğrulayan bir ters vekil sunucunun arkasına koy.

## Modelflare'de oturum açma

- Oturum açma, PKCE ile OIDC yetkilendirme kodu akışını kullanır (RFC 7636), RFC 8252'ye göre yerel bir uygulama olarak: AnyModelBot, istemci gizli bilgisi olmayan bir genel istemcidir ve yetkilendirme sonucu geçici bir geri döngü portuna iletilir.
- modelflare.dev üzerinde oturum açarsın; AnyModelBot Modelflare parolanı hiç görmez.
- Bu cihazın yetkisini Modelflare profil sayfandaki “Yetkili uygulamalar” altında istediğin zaman geri al. Uygulamadaki “Oturumu kapat” da yetkiyi geri alır ve bu cihaz ile botları için verilmiş anahtarları siler.

## Model istekleri ve Modelflare

- Model istekleri paketlenmiş magpie ağ geçidinden Modelflare'e gider; Modelflare onları seçtiğin sağlayıcıya iletir.
- Bir istek, modelin yanıtlamak için gerek duyduğunu içerir: istem, sohbet bağlamı, kullanımda olan bellek, dosya içerikleri, araç sonuçları ve bilgisayar kullanımında ekran görüntüleri.
- İstekler, Modelflare'in kaynağı tanıması için bir `X-Modelflare-Skill: anymodel-bot/<version>` üst bilgisi taşır; uygulamadan açılan Modelflare bağlantıları `utm_source=anymodelbot` taşır. Uygulama bakiye yükleme sayfasını açınca URL, oturum açma kimlik belirtecindeki hesap tanımlayıcısını `#` sonrasında taşır (`#amb_account=…`, bu bir giz değildir) ki Modelflare sayfası tarayıcının aynı hesapta oturum açıp açmadığını denetleyebilsin; `#` sonrasındakiler sunuculara, CDN'lere veya analiz betiklerine gönderilmez. “Anahtar yapılandırması değişti” bildirimi, anahtarın rastgele bir tuzla yerelde hesaplanan HMAC'ini karşılaştırır; anahtar ve özeti bu iş için ne saklanır ne de yüklenir.
- Modelflare istek günlüklerini tutar; neyin ne kadar tutulduğu [Modelflare Güven Merkezi](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) içindedir. Her model sağlayıcısının veriyi nasıl işlediği kendi koşullarına bağlıdır.

## Kendi resmi API anahtarların

- Karşılama ekranında veya Ayarlar → Modeller'de OpenAI, Anthropic veya başka bir sağlayıcının resmi anahtarını girdikten sonra yerleşik ağ geçidi o sağlayıcının model isteklerini doğrudan onlara gönderir. Modelflare'den geçmezler ve `X-Modelflare-Skill` üst bilgisini taşımazlar. İçeriğin nasıl tutulduğu o sağlayıcının kendi koşullarına bağlıdır.
- Sağlayıcı adresleri uygulamada sabittir ve arayüzden veya API'sinden değiştirilemez, bu yüzden anahtarın başka yere gönderilmez. Anahtarlar yalnızca ağ geçidinin yalıtılmış yapılandırmasında durur (kip 600), günlüklerde veya komut satırı argümanlarında hiç durmaz ve arayüz yalnızca son 4 karakteri gösterir.
- Yalnızca resmi anahtarlarla ve oturum açmadan uygulama, Modelflare'in hesap verisini veya fiyat kataloğunu okumaz. Bir anahtar girdiğinde uygulama onu denetlemek için o sağlayıcının model listesini bir kez okur, sonra listeyi güncel tutmak için saatte bir okur.
- Yerleşik ağ geçidi, genel model kataloğunu `models.dev` adresinden okur (bağlam uzunlukları, başvuru fiyatları). Bu istek yalnızca indirir ve anahtar veya sohbet içeriği taşımaz.
- Görüntü ve video üretimi yalnızca Modelflare üzerinden kullanılabilir.

## Telemetri

- Paketlenmiş bilgisayar kullanımı sürücüsündeki (Cua Driver) telemetri `CUA_TELEMETRY_ENABLED=0` ve `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` ile kapatılır.
- Paketlenmiş magpie ağ geçidi otomatik güncelleme ve hesap keşfi kapalı çalışır ve bilgisayarındaki başka yapay zeka araçlarının kimlik bilgilerini okumaz.
- AnyModelBot'un kendi kodu (`src`, `electron`, `ui`, `scripts`, `dsh-runtime/plugins`) analiz veya telemetri bildirimi içermez: telemetry, analytics, sentry, posthog ve mixpanel araması yalnızca yukarıdaki iki Cua ortam değişkenine denk gelir.
- Paketlenmiş üçüncü taraf bileşenler kendi belgelerinin anlattığı gibi davranır; onlar için burada güvence vermiyoruz.

## Uygulamanın yaptığı diğer ağ istekleri

Model isteklerinin dışında uygulama şunlar için çevrimiçi olur:

- Modelflare'in model kataloğunu, bakiyeni, kullanımını ve bildirimlerini okumak (hesap verini, modelflare.dev'den).
- İstekler ve Geri Bildirim'den gönderdiğinde (kullanım senaryoları ve fikirler, sorun bildirme ya da kurumsal ve ortaklıklar): yazdıkların, eklediğin bağlam ya da şirket bilgileri, seçtiğin rol, pencereyi nereden açtığın, sürüm ve sistem bilgileri, eklemeyi seçtiğin hata ve günlükler (anahtarlar `***` ile değiştirilmiş) modelflare.dev'e, Modelflare hesabında gizli bir talep olarak gider. Yanıtlar e-postayla gelir ve Modelflare'in talepler sayfasında görünür. Göndermeden önce gönderilecek her şeyi görebilirsin; sohbetler ve ekran görüntüleri asla eklenmez. İletişim bilgileri varsayılan olarak gönderilmez: yalnızca “Biraz daha konuşalım mı?” bölümünü açıp “Yalnızca bu geri bildirimle ilgili iletişime geçilmesini kabul ediyorum” kutusunu işaretler ve hesap e-postanı seçer ya da bir e-posta veya WeChat kimliği girersen gider; yalnızca o geri bildirim için kullanılır. Pencereyi kapatınca, giriş yapınca ya da hesap değiştirince yeniden sorulur. Taslaklar yalnızca bu cihazdaki veri klasöründe durur (hesaba göre ayrı, yalnızca sen okuyabilirsin, botlar okuyamaz, 7 gün kullanılmazsa silinir) ve hiçbir yere eşitlenmez. Modelflare'e giriş yapmadıysan ya da harici bir ağ geçidi kullanıyorsan uygulama içinde talep oluşturulamaz; e-postayla ya da GitHub'da (herkese açık) kendin gönderebilirsin, bu kopyada iletişim ve şirket bilgileri yer almaz. “Modelflare ile iletişime geç” yazdığın hiçbir şeyi eklemeden kurumsal iletişim sayfasını açar.
- Görüntü veya video üretirken bir modelin istek biçimini docs.modelflare.dev adresinden okumak.
- WeChat kanalı: `ilinkai.weixin.qq.com` ile konuşmak ve gönderdiğin görüntüleri ve dosyaları WeChat CDN'inden indirmek.
- Feishu kanalı: Feishu Open Platform'a uzun bir bağlantı tutmak.
- Telegram, Slack ve Discord kanalları: bağlandıktan sonra mesajları ve gönderdiğin dosyaları almak ve göndermek için `api.telegram.org`, `slack.com`, `discord.com` ve onların dosya barındırıcılarıyla konuşmak.
- Windows'ta, ajan kipi açıkken ve sistemde çalışan bir PowerShell 7 yokken, PowerShell 7'yi Microsoft'un resmi yayın yerinden indirmek (bunu `AMB_PWSH_AUTO_INSTALL=0` ile kapat; [geliştirme kılavuzuna](./development_tr.md) bak).
- Kurulu masaüstü uygulamaları başlangıçtan sonra ve her 6 saatte bir GitHub'da güncelleme denetler ve güncelleme dosyalarını varsayılan olarak arka planda indirir. Otomatik indirmeyi Ayarlar → Genel içinde kapatabilirsin. İstekler hesap kimlik bilgisi veya sohbet içeriği taşımaz. Kurulum, çalışan görev yokken Yeniden başlat ve güncelle'ye tıklamanı gerektirir.
- Henüz kurmadığın bir sürüm için Yenilikler'i açınca uygulama o sürümün değişiklik günlüğünü GitHub'dan okur (`raw.githubusercontent.com`). Bunu yalnızca sen açınca yapar; hesap kimlik bilgisi veya sohbet içeriği yoktur. Kurulu sürümlerin değişiklik günlüğü uygulamayla gelir ve ağ gerekmez.
- Yalnızca uzak bir bot kataloğu kullanmak için `AMB_CATALOG_URL` değerini açıkça ayarlarsan uygulama listenin kendisini alır ve paketleri istenince indirir; imzaları ve karmaları doğrular, verini yüklemez. Varsayılan olarak resmi bot kataloğu, arayüzler, örnek veriler ve beceriler uygulamayla gelir; onları açmak ve kurmak böyle bir ağ isteği yapmaz.

## Bilgisayar kullanımı ve ekran görüntüleri

- Ekranı okumak ekran görüntüsü alır; bunlar model isteğinin parçası olarak görme yeteneği olan bir modele gönderilir.
- Varsayılan olarak bilgisayar kullanımı eylemleri kendiliğinden çalışır. Bot ayarları → Bilgisayar kullanımı içinde “ekranı değiştiren eylemlerden önce bana sor”a geçebilirsin; ekranı okumak kendiliğinden kalır.
- Salt okunur hazır ayarlı botlar yalnızca okuma araçlarını alır.

## Kanallar

- WeChat, Feishu, Telegram, Slack veya Discord üzerinde bir botla karşılıklı gönderdiğin mesajlar o platformların sunucularından geçer ve onların gizlilik politikalarına tabidir.
- Varsayılan olarak bir bota yalnızca sahip ve izin verdiklerin konuşabilir; başkasından gelen mesajlar bir modele verilmez, yalnızca erişim isteği olarak kaydedilir ([geliştirici kılavuzuna](./development_tr.md#bir-botu-kim-kullanabilir) bak).

## Verilerini silme

1. AnyModelBot'tan çık (sistem tepsisi menüsü → Çık).
2. Yukarıdaki tablodaki veri klasörünü sil. Docker: `docker rm -f amb && docker volume rm amb-data`.
3. Modelflare profil sayfandaki “Yetkili uygulamalar” altında AnyModelBot'un yetkisini geri al.
4. Gerekirse Feishu Open Platform'da oluşturduğun uygulamaları kapat (tarayarak oluşturulanlar dahil), botun WeChat bağını çöz, Telegram (@BotFather), Slack ve Discord'da oluşturduğun botları sil ve her uygulamanın kendi ayarlarında (Notion, Feishu, GitHub ve benzeri) AnyModelBot yetkisini geri alıp oluşturduğun belirteçleri ve anahtarları sil.
