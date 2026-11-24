# Değişiklik günlüğü

[简体中文](./CHANGELOG.md) | [English](./CHANGELOG_en.md) | [日本語](./CHANGELOG_ja.md) | [한국어](./CHANGELOG_ko.md) | [Русский](./CHANGELOG_ru.md) | [Español](./CHANGELOG_es.md) | [Português (Brasil)](./CHANGELOG_pt.md) | Türkçe

Uygulamada fark edeceğin değişiklikler burada. Daha eski sürümler için [GitHub sürümlerine](https://github.com/modelflare-ai/AnyModelBot/releases) bak.

## 0.1.48 - 2026-11-25

### Yenilikler

- **Bu bilgisayardan beceri içe aktarma:** masaüstü uygulamasında, bilgisayardaki diğer araçlar için (Claude Code, Codex, Cursor, CodeBuddy ve diğerleri) zaten kurulu olan beceriler tek seferde içe aktarılabilir. `~/.claude/skills/` gibi sık kullanılan altı yer otomatik aranır, Klasör seç… ile bir beceri klasörü veya proje de seçilebilir; siz seçip İleri'ye tıklayana kadar yalnızca klasörler ve dosya adları görülür. Gözden geçirme her biri için içe aktarılabilir, zaten var, aynı ad farklı içerik (varsayılan olarak atlanır ya da ayrı kaydedilir) veya uyumsuz bilgisini nedeniyle birlikte verir. İçe aktarma hiçbir betiği çalıştırmaz; özel olabilecek dosyalar ya da bu uygulamanın aynı şekilde koruyamayacağı çağrı sınırları içeren beceriler içe aktarılmaz. Bir botun ayarlarından açıldığında içe aktarılanlar varsayılan olarak o botta açılır.
- **Beceri kitaplığım:** avatar menüsüne, bu bilgisayardaki her becerinin tek kopyasını tutan Beceri kitaplığım eklendi; arama yapabilir, içeriği ve onu kullanan botları görebilirsiniz. Bot ayarları › Beceriler bölümüne Kitaplıktan ekle… geldi ve her anahtar yalnızca o botu etkiler. ZIP veya GitHub ile kurulan beceriler ve kaydettikleriniz de yeniden içe aktarmaya gerek kalmadan kitaplıkta listelenir.

### İyileştirmeler ve düzeltmeler

- **Paylaşılan beceriler kimin etkileneceğini söyler:** birkaç botun kullandığı bir beceriyi ZIP veya GitHub bağlantısıyla değiştirirken ya da birkaç botta açık olan Becerilerim'den birini güncellerken değişikliği alacak diğer botlar belirtilir.
- **Bot silmek artık becerilerini silmiyor:** ona kurulu beceriler Beceri kitaplığımda kalır; başka bir bota eklenebilir veya kitaplıktan kaldırılabilir.

## 0.1.47 - 2026-11-23

### Yenilikler

- **Görselleri görsel oluşturmada referans olarak kullanma:** Modelflare hesabıyla giriş yapıp bir botla birebir sohbete görsel eklediğinizde, ek sayısının yanında varsayılan olarak kapalı “Görsel oluşturmada referans olarak kullan” anahtarı görünür. Açtığınızda o mesajdaki görseller gösterilen sırayla referans olur; sağ altta seçili model görseli oluşturur ve sonuç aynı sohbete gelir. Yalnızca görsel eklemek hiçbir zaman ücretli bir oluşturma başlatmaz. Geçerli model bunu yapamıyorsa, yetenekleri henüz doğrulanamıyorsa ya da görseller modelin sayı, biçim veya boyut sınırlarını aşıyorsa mesaj kutusunun üstündeki bir not nedenini açıklar; içindeki “Model değiştirin” bağlantısı her zamanki model seçiciyi açar. Ücret onayı eskisi gibi çalışır (her seferinde ya da tahmin $0.5'i aştığında) ve sonucu doğrulanamayan bir istek asla kendiliğinden yeniden denenmez. Modelflare'in model yetenek bilgisini sağlaması gerekir; doğrulanamazsa hiçbir şey gönderilmez. Kendi API anahtarlarınızla henüz kullanılamaz.
- **Model seçiciden görsel oluşturma modeli seçme:** giriş yaptığınızda sağ alttaki model seçici, hesabınızın kullanabildiği görsel oluşturma modellerini de listeler. Birini seçip istediğiniz görseli tarif etmeniz yeterli; hiçbir sohbet modeli devreye girmez.

### İyileştirmeler ve düzeltmeler

- **Görsel oluşturma yalnızca seçili modeli kullanır:** giriş yapmışken bir bottan sözle görsel istediğinizde yalnızca sağ altta seçili model kullanılır. O model görsel oluşturamıyorsa ya da yetenekleri doğrulanamıyorsa bot nedenini söyler ve model değiştirmenizi ister; ayrı bir varsayılan görsel modeline geçmez (giriş yapılmışken ayarlardaki “Varsayılan görsel modeli” gizlenir). Yalnızca API anahtarıyla bağlandığınızda hiçbir şey değişmez.

## 0.1.46 - 2026-11-22

### Yenilikler

- **Çalışma klasörü:** masaüstü uygulamasında mesaj kutusunun üstünden bir klasör seçin; bot dosyalarla oldukları yerde çalışır, onları tek tek sürüklemeniz gerekmez. Çalışma alanı erişimiyle bot bu klasördeki dosyaları her seferinde sormadan düzenleyebilir; başka bir yere yazmak yine onayınızı gerektirir. Her mesaj gönderildiğinde seçili olan klasörle işlenir: mesaj sıradayken veya onay beklerken klasörü değiştirseniz de başka bir yere yönelmez; ondan başlatılan arka plan görevleri de aynı klasörde çalışır. Son kullandığınız 10 klasör tek tıkla seçilebilir; uygulamanın veri klasörü, bir diskin kökü ve ana klasörünüzün kendisi seçilemez. Web konsolu seçili klasörü gösterir; seçmek veya değiştirmek için botun çalıştığı bilgisayardaki masaüstü uygulamasını kullanın.
- **ZIP ekleri:** bir ZIP'i (en fazla 50 MiB) sohbete sürükleyin; görseller ve dosyalarla birlikte ya da tek başına gönderin. Bot içine bakmayı veya açmayı ancak ne yapılacağını söyledikten sonra yapar: varsayılan olarak kendi çalışma alanına, isterseniz çalışma klasörüne açar ve içindekileri kendi başına çalıştırmaz. Şifreli veya bölünmüş ZIP'ler, güvenli olmayan yollar içerenler ve açıldığında 200 MiB'ı ya da 2.000 öğeyi aşanlar nedeni belirtilerek reddedilir. Orijinal dosyayı kaydetmek için gönderilmiş bir ZIP'e tıklayın. Ajan modu gerekir.

### İyileştirmeler ve düzeltmeler

- **Ekler:** birkaç dosyayı birlikte sürüklediğinizde eklenebilenler eklenir, eklenemeyenler nedenleriyle tek satırda listelenir; artık tüm grup reddedilmez. Dosya kartları dosya türünü gösterir ve uzun adlarda uzantıyı görünür tutar.

## 0.1.45 - 2026-11-22

### İyileştirmeler ve düzeltmeler

- **Komut sanal alanı (Linux):** bir botun çalıştırdığı komutlar artık yalnızca bubblewrap sanal alanında çalışır. bubblewrap kurulu değilse ya da sistem onun ad alanı oluşturmasına izin vermiyorsa komut, nedeni ve nasıl düzeltileceği (bubblewrap'i kurmak veya ona izin vermek) belirtilerek reddedilir; yalnızca yazmayı kısıtlayan ve komutların uygulamanın veri klasörünü okumasına izin veren bir sanal alana sessizce geçilmez. Tam erişimli botlar etkilenmez. Resmî Docker imajı bu sanal alana varsayılan olarak izin vermeye devam eder, çünkü varsayılan seçeneklerle başlatılan bir kapsayıcı bubblewrap'in ihtiyaç duyduğu ad alanlarını oluşturamaz; kapatmak için `-e AMB_ALLOW_LANDLOCK=0` ekleyin.
- **Komut satırı sürümünde erişim belirteci:** `npm start` ile çalıştırdığınızda artık yerel konsol için de erişim belirteci gerekir. Terminalden başlatıldığında belirteçli adresi bir kez yazdırır; tarayıcıda bir kez açtığınızda tarayıcı onu hatırlar. Belirteç veri klasöründeki `ui-token` dosyasına da kaydedilir ve `npm run bot` onu otomatik okur. Masaüstü uygulaması ve Docker eskisi gibi çalışır.

## 0.1.44 - 2026-11-20

### İyileştirmeler ve düzeltmeler

- **Görsel ekleri:** bazı görseller sohbete sürüklendiğinde veya yapıştırıldığında desteklenmeyen biçim sayılıp reddediliyordu; artık ekleniyor: uzantısı gerçek biçimiyle uyuşmayan görseller (örneğin .jpg olarak kaydedilmiş bir PNG veya WebP), görselin ardından ek veri taşıyan telefon JPEG'leri ve hareketli fotoğraflar (yalnızca durağan kare kullanılır), ayrıca .jfif veya .jpe uzantılı görseller. Gerçekten eklenemeyen bir görsel için artık Markdown, HTML veya TXT kullanmanız değil, görseli PNG veya JPG'ye dönüştürmeniz istenir.
- **Önizleme güvenliği:** bir botun ürettiği web sayfasını önizlerken sayfadaki betikler aynı klasördeki diğer dosyaların içeriğini artık okuyamaz (fetch engellenir); stiller, betikler, görseller ve yazı tipleri eskisi gibi yüklenir. JSON gibi veri dosyaları önizlenen sayfalara artık sunulmaz; veriyi HTML'in içine gömün veya betik olarak verin.
- **Uygulama içi güncelleme:** macOS'te "Yeniden başlat ve güncelle"ye tıkladıktan sonra kurulum sırasında "AnyModelBot bir sorunla karşılaştı" penceresi artık çıkmıyor. Düzeltme 0.1.44'ten itibaren geçerlidir: eski bir sürümden 0.1.44'e güncellerken pencere bir kez daha çıkabilir, güncelleme yine de normal şekilde tamamlanır.

## 0.1.43 - 2026-11-20

### Yenilikler

- **Görsel ve dosya ekleri:** sohbete bir ekran görüntüsü veya görsel yapıştırın ya da görselleri ve metin dosyalarını (Markdown, HTML, TXT, CSV, JSON, kod ve diğerleri) sürükleyin ve mesajınızla birlikte gönderin. Yalnızca ek de gönderebilirsiniz. Görseller, görselleri görebilen modellere; dosyaların tam metni modele iletilir. Küçük resme tıklayarak büyütebilirsiniz. Her mesajda en fazla 8 ek (en fazla 4’ü görsel) ve ek başına en fazla 10 MiB. Geçerli model görselleri desteklemiyorsa uygulama bunu bildirir. PDF, Office belgeleri, arşivler, ses ve video henüz desteklenmiyor.
- **İstekler ve Geri Bildirim:** "Geri bildirim" artık "İstekler ve Geri Bildirim" ve üç kategorisi var: Kullanım senaryoları ve fikirler, Sorunlar, Kurumsal ve iş birliği. Her birinin taslağı ayrı tutulur. İletişim bilgileri yalnızca o gönderim için onay kutusunu işaretlerseniz, günlükler yalnızca işaretlerseniz eklenir; göndermeden önce gönderilecek her şeyi görebilirsiniz. Keşfet’e kurumsal senaryolar bölümü eklendi.

### İyileştirmeler ve düzeltmeler

- **Bilgisayardaki dosyaları düzenleme:** bir bottan Masaüstü veya başka klasörlerdeki dosyaları düzenlemesini istediğinizde artık önce Erişilebilirlik veya Ekran Kaydı istenmiyor; çalışma alanı dışındaki işlemler yine onayınızı gerektirir. Bir görev gerçekten bir masaüstü uygulamasını kullanmayı gerektiriyorsa ve sistem izni eksikse, sohbette izni açabileceğiniz bir kart görünür.
- **Önizleme:** odak önizlemedeyken Cmd+W / Ctrl+W yalnızca geçerli sekmeyi kapatır; boş önizleme ve + menüsü bu sohbette açılan dosyaları listeler.
- **Beceriler:** "Beceri olarak kaydet" varsayılan olarak en son tamamlanan isteği taslağa alır; taslak kartındaki seçimler düzenlemeden sonra korunur; içe aktarma bildirimi ve kartlar artık "Yükleniyor"da kalmaz.
- **Sohbet ve görevler:** içerik veya mesaj kutusu büyüdüğünde sohbet en altta kalır, notlar ve kartlar kutunun arkasında kalmaz; bir botun Görevler sekmesi diğer botların gönderdiği işleri ve kimin gönderdiğini gösterir.

## 0.1.42 - 2026-11-18

### Yeni

- **Uygulama içi geri bildirim:** geri bildirim penceresini hesap menüsündeki Geri bildirim'den, sohbette bir hatanın altındaki "Bu sorunu bildir"den, Ayarlar → Sorun giderme'den veya Ayarlar → Hakkında'dan açabilirsin. Sorun, Öneri ya da Diğer'i seç, birkaç satır yaz ve gönder. Sürüm ve sistem bilgileri her zaman eklenir; bir hatadan açtıysan o hata da eklenir. Tanılama bilgileri yalnızca kutuyu işaretlersen eklenir, göndermeden önce metnin tamamını önizleyebilirsin; sohbetler ve ekran görüntüleri asla eklenmez. Modelflare'e giriş yaptıysan geri bildirimin hesabında bir destek talebi olur: yanıtlar e-postana gelir ve Modelflare talepler sayfasında görünür, günde en fazla 3 kez. Giriş yapmadıysan GitHub üzerinden ya da e-postayla gönderebilirsin; ayrıntılar senin için doldurulur.

### İyileştirmeler ve düzeltmeler

- **E-posta bağlantıları:** masaüstü uygulamasında sohbetteki e-posta bağlantıları sistemin e-posta uygulamasında açılır. Önceden tıklayınca hiçbir şey olmuyordu.

## 0.1.41 - 2026-11-16

### Yeni

- **Türkçe:** Arayüz, sistem tepsisi menüsü, botların sistem mesajları, site ve belgeler Türkçe. İlk kurulumda veya Ayarlar → Genel → Dil bölümünden Türkçe'yi seç. Sistem dili Türkçeyse uygulama onu kendisi kullanır. Yüzde işareti sayıdan önce gelir ve ABD hisse araştırması grafikleri bu yazımı okur. Ana sayfadaki tanıtım videosu hâlâ İngilizce kayıt.

## 0.1.40 - 2026-11-15

### Yeni

- **Görev kitaplığı:** Zamanlanmış sayfası haber, iş, öğrenme, günlük yaşam ve finans için 20 hazır görev ekler. Birini seç, birkaç alanı doldur, bir bot ve bir hedef seç, sonra aç; bir bottan sohbette kitaplık kuralı oluşturmasını da isteyebilirsin. Denetim görevleri önce bir kez denenebilir; sonuçlar yalnızca deneme iletişim kutusunda ve çalışma günlüğünde görünür, sohbet kanallarına gönderilmez. Bilgisayar ve uygulama çalışıyor olmalıdır.
- **Daha zengin dosya önizlemeleri:** kod satır numaraları, sözdizimi vurgusu ve kaydırma kazanır; JSON biçimlendirme ve katlama destekler; CSV/TSV tablo, sıralama, arama ve kodlama seçimi destekler. Markdown görüntü, görev listesi, anahat ve kaynak görünümü destekler; görüntüler yakınlaştırma ve kaydırma destekler; HTML önizleme ile kaynak arasında geçiş yapar.

### İyileştirmeler ve düzeltmeler

- **Önizleme denetimleri ve yenileme:** sekmelerin dosya türü simgeleri ve bağlam menüleri vardır ve “+” sohbette teslim edilen dosyaları listeler. Paneli uygulamayı dolduracak kadar genişlet, görünüm, yakınlaştırma ve kaydırma tercihlerini tut ve dosyalar değişince yenile. Masaüstü Farklı kaydet, Klasörde göster ve HTML'i tarayıcıda açmayı destekler.
- **Kural zamanlamaları ve sonuçlar:** yıllık anımsatıcılar ve aylık veya yıllık tarihlerden birkaç gün önceki anımsatıcılar eklendi. Kitaplık denetimleri çok satırlı özet gönderebilir, deneme maliyetleri aylık kullanıma sayılır ve yaygın cron zamanlamaları daha kolay okunur.
- **Site:** topluluk metin menüsü üzerine gelince veya klavye odağı alınca açılır, ana sayfa özellik bölümü daha sadedir ve değişiklik günlüğü yalnızca yayınlanmış sürümleri gösterir.

## 0.1.39 - 2026-11-15

### Yeni

- **Kurulumdan hemen sonra ne diyeceğini bil:** **Beceriler ve uygulamalar** altında bir beceri ZIP'i içe aktardıktan veya bir uygulamayı bir bota atadıktan sonra onay, **Girişe ekle** ve **Kopyala** ile bir **Şunu dene** örneği ekler.

### İyileştirmeler ve düzeltmeler

- **Yeni sohbetler hemen başlar:** yeni sohbet düğmesi, + menüsündeki **Yeni sohbet** ve /new yazmak hemen yeni bir sohbete geçer ve sohbette bir “Yeni sohbet başladı” satırı bırakır (yeniden yükleme veya yeniden başlatmadan sonra da durur). “Düşünüyor”da takılı bir “/new” balonu kalmaz. Nerede kaldığın arka planda bir devir notu olarak yazılır ve yeni sohbetin ilk mesajı onu en çok 8 saniye bekler. Bir yanıt sürerken düğme grileşir. Sohbet uygulamalarındaki /new de hemen yanıtlar.
- **Hesap alanında adın ve resmin:** Modelflare'de oturum açtıktan sonra sol alt köşe ve hesap menüsü “Modelflare hesabı” yerine takma adını ve profil resmini gösterir (yoksa kendi kullanıcı adın, sonra e-postan; resim yoksa adının ilk harfi). Yeniden başlatmadan sonra son adın hemen görünür.
- **Süreç hangi aracın kullanıldığını gösterir:** her uygulama aracı kendi satırını alır, örneğin “Notion kullanılıyor · Sayfa ara”; yanıt bitince “Kullanıldı: Notion · Sayfa ara, Notion · Sayfa oku” olarak katlanır.
- **Daha açık bir beceri listesi:** **Uygulamalar ve beceriler › Beceriler** artık kartlar gösterir. Yazar resimleri baş harfle başlar, yüklenince belirir ve cihazında tutulur, böylece bir sonraki sefere hemen görünür. **GitHub ↗** ve **Kurulum istemini kopyala** her zaman görünür ve artık başlığı sıkıştırmaz.
- **Ayarlar tıklanabilir şeyleri belli eder:** Ayarlar ve bot ayarlarındaki eylemler küçük hap düğmelerdir; Sil, Kaldır ve Oturumu kapat kırmızıdır. Tek “Görüntüle”si olan bir satırın tamamı tıklanabilir ve bir satırda en çok iki düğme vardır, kalanı “⋯” altındadır.
- **Seçiciler ve küçük düzeltmeler:** **Kendi API anahtarını kullan** sayfasındaki **Sağlayıcı** seçicisi ve Önizleme'deki anahtar oku sağ kenarda tutar ve satırın herhangi bir yerinden açılır. Kurulu ama henüz etkin olmayan bir beceri “Sonraki mesajından itibaren hazır” der. Henüz kullanmadığın yerleşik botlarda kenar çubuğu “⋯” artık “yeni” noktasını örtmez.

## 0.1.38 - 2026-11-15

### Yeni

- **Gerçek modele geri döner:** daha önce seçtiğin ve aslında “auto/…” olan bir model (genel varsayılan, bir botun varsayılanı veya bir sohbette değiştirilen bir model) başlangıçta eşleşen gerçek modele, yoksa varsayılana döner.

### İyileştirmeler ve düzeltmeler

- **Model listesinde artık “auto/…” modeller yok:** bir model birden çok kaynaktan sunulunca (örneğin kendi bütçesi olan bir bot veya Modelflare'in yanında eklenen bir resmi API anahtarı) liste, özgün gibi görünen ama aslında “auto/model-adı” olan bir girdi kazanıyordu ve onu seçmek bilinmeyen modelle isteklerin başarısız olmasına yol açıyordu. Artık listelenmez ve gönderilmez.

## 0.1.37 - 2026-11-15

### Yeni

- **Hakkımda:** ekip belleği artık Hakkımda; tüm botlarının paylaştığı, seninle ilgili şeyler için. Herhangi bir sohbette bir kez söyle (“Melody'yim” gibi) ve her bot bilsin; yanıtın altındaki tek satırlık bir not geri almanı sağlar. Botlar bir adres, telefon numarası veya e-postayı kaydetmeden önce sorar, senin düzenlediğin satırları geri değiştirmez ve sildiğin satırları geri eklemez. Ayarlar › Hakkımda içinde görüntüle ve düzenle; son 30 günün her değişikliği geri alınabilir. Eski ekip belleğin kendiliğinden taşınır.
- **Botlar birbirine mesaj atabilir:** uygulamada bir bota “bunu Ürün Asistanı'na ver” de; görevi, arka planı ve dosyaları o bota gönderir. Öteki bot kendi modeli, izinleri ve bütçesiyle arka planda çalışır, onayını aynı sohbette kendi adıyla ister ve bitince yanıtlar. İlk bot sonucu denetler, gerekirse yeniden yapılmasını ister, sonra sana söyler. Konuşmalarını görmek için sohbetteki gri satıra tıkla. Modelflare'de oturum açmak gerekir ve iki bot da Modelflare modellerinde olmalıdır.
- **Bot iş birliği ayarları:** Ayarlar › Bot iş birliği içinde kapat veya istek başına harcama, süre, günlük istek ve yeniden yapma sınırları koy; botlar arasındaki sohbetlere ve neye mal olduklarına bak.

### İyileştirmeler ve düzeltmeler

- **Bot ayarları ve Bellek sekmesi:** bot başına “Ekip belleğine yazmaya izin ver” anahtarının yerini bir Hakkımda bağlantısı alır. Bellek sekmesi kaç Hakkımda satırı olduğunu gösterir; orada görüntüleyebilir veya silebilirsin.
- **Bellek gözden geçirmesi:** seninle ilgili olgular artık tek bir botun belleğine gitmez; çelişince Hakkımda kazanır.
- **Mesajlaşma uygulamalarında:** bir bot özel bir WeChat veya Feishu sohbetinde seninle ilgili bir şey not edince yanıtı bir satır izler ve “geri al” yanıtı onu geri alır. Adresler, telefon numaraları ve e-postalar yalnızca o sohbette kullanılır.

## 0.1.36 - 2026-11-15

### Yeni

- **Yaptığını beceri olarak kaydet:** bir bot bir şeyi doğru yapınca giriş kutusunun + menüsünden “Beceri olarak kaydet…”i seç, `/skill` gönder veya yalnızca “beceri olarak kaydet” de. Bot adımları, düzelttiklerini, kullandığı uygulamaları ve becerileri ve bir “Şunu dene” satırını içeren bir kart taslağı çıkarır. Becerilerim'e kaydet, tek anahtarla başka botlar için aç veya zamanla. Gizli bilgiler bir beceriye hiç yazılmaz ve telefon numarası, e-posta gibi kişisel ayrıntılar varsayılan olarak her seferinde sorulur. Bir beceriyi güncelleyebilir, önceki sürümü geri yükleyebilir veya ZIP olarak dışa aktarabilirsin.
- **WeChat ve Feishu'dan beceri kaydet:** WeChat, Feishu, Telegram, Slack ve Discord'daki özel sohbetler de başlatabilir. Tutmak için “kaydet”, bırakmak için “vazgeç” yanıtla; bir gruptan başlatılamaz.
- **Beceri kitaplığı:** Uygulamaları bağla artık Uygulamalar ve beceriler; yeni Beceriler sekmesi 31 açık kaynak depodan 155 beceriyi kategoriye ve yazara göre listeler. Bir kurulum istemini kopyala ve herhangi bir bota gönder veya bir becerinin GitHub bağlantısını gönder, sonra kurmak için kartı onayla.
- **Becerileri ve uygulamaları sohbette kullan:** giriş kutusundaki + → Beceriler ve uygulamalar botun kullanabildiklerini listeler; “{name} kullanarak bana yardım et…” eklemek için birini seç. Yanıtın üstünde hangi beceri ve uygulamaların kullanımda olduğunu veya kullanıldığını görürsün ve beceri adları ayrıntılarını açar.

### İyileştirmeler ve düzeltmeler

- **Daha kolay bir beceri listesi:** açık beceriler önce gelir. 10'dan fazla olunca ara ve Becerilerim, GitHub, Yerel ZIP veya Kapalıya göre süz. Her beceri etkin olup olmadığını, nereden geldiğini ve bir “Şunu dene” satırını gösterir.
- **Deneme kredisi sırasında şablonlar:** şablonlar geçerli kredine uyan bir model katmanı kullanır ve normalde hangi katmanı önerdiklerini söyler.
- **Bilgisayar kullanımı izinleri:** bir arka plan görevi eksik bir izin yüzünden durunca izin kartı artık görünür ve geride yetim bir bekleme durumu kalmaz.
- **Başlangıç ve bildirimler:** engellenmiş bir denetim listesi adımına tıklamak nedenini açıklar. Bildirimler artık ana alanın üst ortasında görünür.
- **Zamanlanmış kurallar:** genişletilmiş bir kural istem, sıklık, sonraki çalışma ve hedef olarak ayrılır. Bir bot seçmek aranabilir bir liste kullanır ve yeni kurallar “Anımsatıcı gönder” veya “Bir görev yap” kartlarıyla başlar; bunlar Becerilerim'den birini izleyebilir. Boş durumlar ve saat dilimi notu daha açıktır.
- **Güncellemeler, hesap ve ayrıntılar:** güncelleme girişi sürümü adlandırır. Hesap ayrıntıları yüklenemezse yeniden denenebilir, Oturumu kapat kırmızıdır, uygulamadaki grup sohbetleri bakiye bitince bir bakiye yükle eylemi gösterir, şablon kartlarının kenarlığı vardır ve bağlantıları oku bırakır.

## 0.1.35 - 2026-11-14

### Yeni

- **Daha sade kenar çubuğu ve simgeler:** standart eylemler artık Heroicons kullanır. Daralt, ara ve yeni üstte kalır; Zamanlanmış etiketli bir gezinme öğesi olur. Hesabının yanındaki güncelleme düğmesi güncellemeleri indirir ve hazır olunca kurmak için yeniden başlar.
- **Bakiye doğrudan Ayarlar'da:** Ayarlar → Modeller hesap bakiyeni, bot kredini ve kalan yüzdeyi, yenileme ve bakiye yükleme eylemleriyle gösterir. Kenar çubuğu bakiye halkası ve üzerine gelme kartı kaldırıldı.

### İyileştirmeler ve düzeltmeler

- **Kararlı kaynak önizlemeleri:** site girişi ve kaynak seçimi paylaşılan denetimler kullanır. Sağ panel sekmelerini değiştirmek, elle ayarlamalar dahil genişliğini korur. Daraltmadan sonra kenar çubuğu genişlet düğmesinin tıklanamaz olması düzeltildi.
- **Daha açık hata kurtarma:** kota ayırma başarısızlıkları, önekli mesajlı hatalar dahil düşük bakiye olarak sınıflanır. Kurtarma eylemleri hesap sağlayıcısına uyar ve kenar çubuğu önizlemeleri artık ham hata yanıtlarını göstermez.
- **Daha açık bilgisayar izinleri:** eksik tek bir izin tekil bir başlık kullanır ve gerektiğinde uygulamayı yeniden açmak ana eylem olur. Yeniden açmadan önce sohbet ve form taslakları ile bekleyen istekler korunur.
- **Kural yönetimi düzeltmeleri:** bir kuralı açıp kapatmak veya hedefini değiştirmek geri almayı elde tutar. Sahipler kuralları sohbetler arasında yönetebilir; grup üyeleri kimliğe göre yalıtık kalır. Sıklık sayıları sonraki 30 günü kapsar; daha düşük sıklık önerileri her üç saatte bir veya günde birdir.
- **Tutarlı başlangıç ve metin:** şablon tohum belleği ve kendiliğinden gözden geçirmeler artık seni anımsama adımını tamamlamaz. Şablon örnekleri, geri alma mesajları, kural formları ve etkinleştirme rehberi yedi dilde hizalandı.

## 0.1.34 - 2026-11-14

### Yeni

- **Erken başlangıç tanıları:** masaüstü uygulaması tek örnek kilidini istemeden önce ayrı bir `startup-<time>-<PID>.log` yazar; işletim sistemi sürümünü, gerçek veri klasörünü, kilit sonucunu ve başlangıç aşamalarını kaydeder. Veri klasörü yazılamazsa sistem geçici klasörünü dener.
- **Başlangıç sorun giderme anahtarı:** tek örnek kilidi alınamayınca tanı günlüğünün yerini göstermek için `--diagnose-startup` ile başlat; penceresiz çıkışları araştırmaya yardım eder.

### İyileştirmeler ve düzeltmeler

- İkinci bir açılış yerel arayüz hizmeti hazır olmadan gelirse pencere etkinleştirmesi başlangıç bitene kadar kuyruğa alınır; erken pencere oluşturma önlenir.
- Her açılışın kendi günlüğü vardır; birincil örnek en son yirmiyi tutar. İkincil bir açılış çalışan uygulamanın olağan `app.log` dosyasını döndürmez.
- Bu, [#71](https://github.com/modelflare-ai/AnyModelBot/issues/71) tanısını iyileştirir; Win11 Insider Build 26300'deki hemen çıkış nedeni henüz doğrulanmadı. `ELECTRON_RUN_AS_NODE` Node kipini seçerse uygulama kodu hiç çalışmaz, bu yüzden o değişkenin önce denetlenmesi gerekir. Varsayılan Windows günlük klasörü `%APPDATA%\anymodel bot\data\logs` olup adında bir boşluk vardır.

## 0.1.33 - 2026-11-14

### Yeni

- **Zamanlanmış kurallar tek yerde:** yeni Zamanlanmış sayfası tüm botlardaki kuralları listeler ve ilgi isteyenleri vurgular. Sohbet kartları, Görevler ve Zamanlanmış açık/kapalı denetimlerini paylaşır. İlk sohbetten önce kural oluştur, onları kapalı tut ve sohbette oluşturulan değişiklikleri geri al. Geri alınan bir oluşturma on dakika geri yüklenebilir.
- **Yetişme çalışmaları ve grup özetleri:** takvim kuralları en çok on iki saatlik bir hoşgörü süresi içinde bir kez yetişebilir; özgün vade zamanı gösterilir. Aralık kuralları yetişmez. Aylık zamanlamalar, sonraki üç çalışma, saat dilimleri ve maliyet tahminleri artık görünür. Grup özetleri seçilmiş bir uygulama içi grup kullanır; geç bir özet özgün tarihini korur.
- **On bot şablonu:** yazma, iş veya öğrenme için bir rol seç, kişiliğini, belleğini ve kurallarını önizle ve oluşturmadan önce uygun modelleri karşılaştır. Şablon kuralları kapalı başlar ve gerektiğinde bir hedef ve kaynak grup ister.
- **Sağ panelde kaynaklar:** sohbetten çıkmadan sohbetlerden, gruplardan ve bot çalışma alanlarından dosya ve site aç. Markdown, metin ve kod, PDF, görüntü ve HTML önizle; indirme ve dışarıda açma seçenekleriyle.
- **Yan panele uyan çalışma alanları:** resmi botlar daha dar genişliklerde proje gezinmesini daraltır. Bir çalışma alanını genişlet ve geçerli düzenleme durumunu koruyarak sohbete dön.
- **macOS izin kurulumundan sonra sürdür:** tek bir izin kartı yinelenen hataların yerini alır. Uygulama kendiliğinden denetler ve uygunsa taslakları koruyarak bitmemiş adımları özgün sohbette sürdürür. Daha yeni bir mesaj veya otuz dakikayı aşan bir bekleme Sürdür ister.

### İyileştirmeler ve düzeltmeler

- Modelflare oturum açma dönüşü, hesap adları ve avatarlar ile ilk kullanım rehberi iyileştirildi. Bağlı uygulama listeleri, arama ve hata mesajları daha açıktır.
- Film Studio tuval düzeni ve US Stock Research grafik verisi işleme iyileştirildi; PPT Master ve Company Research de güncellenmiş çalışma alanını kullanır.
- Kural sonuçları kaynaklarını belirtir ve yanıt bildirimi tercihini izler. İsteğe bağlı bir ayar, fişe takılıyken bir kuralın vadesinden kısa süre önce uykuyu engeller; zaten uyuyan veya kapalı bir bilgisayarı uyandıramaz.

## 0.1.32 - 2026-11-11

### Yeni

- **İspanyolca ve Portekizce (Brezilya):** İki yeni arayüz dili. Ayarlar → Genel → Dil içinde birini seç; sistem dilin İspanyolca veya Portekizceyse uygulama onu kendiliğinden kullanır. Arayüz, sistem tepsisi menüsü, botlardan gelen sistem mesajları ve Yenilikler çevrilmiştir.
- **İspanyolca ve Portekizce resmi botlar:** PPT Master, Film Studio, Company Research ve US Stock Research'ün İspanyolca ve Portekizce adları, açıklamaları, başlangıçları, çalışma alanı arayüzleri ve örnekleri vardır.

### İyileştirmeler ve düzeltmeler

- US Stock Research grafikleri ondalık işareti olarak virgül kullanan sayıları okur (%12,5 gibi) ve temel rakamlardaki değişimler arayüz dilinin sayı biçimini izler.

## 0.1.31 - 2026-11-11

### Yeni

- **Uygulamaları bağla:** Sol alt köşedeki avatar menüsünde yeni bir Uygulamaları bağla öğesi vardır. Kullandığın uygulamaları bağla; botların içeriklerini okuyup yazabilir. Bir kez bağla, her bot varsayılan olarak kullanabilsin; bir botun ayarlarındaki Uygulamalar altında bot başına ve araç başına daraltabilirsin.
- **Yerleşik uygulamalar:** GitHub, Notion, Linear, Atlassian (Jira ve Confluence) ve Canva bir veya iki adımda bağlanır.
- **Çin için yerleşik uygulamalar:** Feishu (bulut belgelerini oku ve yaz, grup sohbeti mesajlarını oku), Tencent Docs, DingTalk, Amap ve Yuque. Çince arayüz onları önce listeler.
- **Özel bağlayıcılar (MCP):** Uygulamalar sayfasındaki MCP'lerim altında ekle. Bir URL, mcpServers JSON'u, bir `claude mcp add` komutu veya yerel bir başlatma komutu yapıştır; tanınır. Formu da doldurabilir veya JSON düzenleyebilirsin. Uzak sunucular ve yerel komutlar çalışır; kimlik doğrulama için oturum açma, üst bilgiler, sorgu parametreleri veya ayrılmış bir URL, en çok 20 bağlayıcı.
- **Verini değiştirmeden önce sorar:** Salt okunur araçlar hemen çalışır. Yazmalar varsayılan olarak önce sohbette sorar ve Bu araca her zaman izin ver'i seçebilirsin; bunu sonra botun ayarlarında geri alabilirsin. Silmeler ve başka insanlara gönderilen her şey her zaman sorar. Salt okunur botlar yazamaz.
- **Bir bağlantıyı sohbetten düzelt:** Bir görev bağlı olmayan bir uygulama isteyince veya bir oturumun süresi dolunca ya da bir anahtar çalışmayı bırakınca sohbette bir kart görünür. Bağlamak veya düzeltmek için tıkla; bot görevle sürer.
- **Sağ panel:** Bilgi paneli artık bir sekme sırasıdır: Genel bakış, Görevler ve Bellek. Resmi botlar kendi arayüzleri için bir Çalışma alanı sekmesi ekler ve ana alan her zaman sohbettir.
- **Kenar çubuğu bölümleri:** Botları, grup sohbetlerini ve resmi botları oluşturduğun bölümlere koy. Bölümler eklenebilir, yeniden adlandırılabilir, silinebilir ve yeniden sıralamak için sürüklenebilir.
- **Resmi botların kendi görünümü var:** PPT Master, Film Studio, Company Research ve US Stock Research her biri kendi avatarını ve yeni bir kapağını alır. Avatarını değiştirmediğin botlar kendiliğinden geçer.

### İyileştirmeler ve düzeltmeler

- Ayarlar › Bağlantılar artık Sohbet kanallarıdır ve yalnızca sohbet uygulaması hesaplarını tutar. Var olan Notion hesapların Uygulamaları bağla'ya taşındı ve yeniden yetki istemez.
- Var olan Feishu mesaj hesapları da yeniden yetki olmadan Uygulamaları bağla altındaki Feishu kartına taşındı; bulut belgelerini de okuyup yazmak için yeniden yetkilendir.
- Notion sayfaları oluşturmak ve güncellemek artık yukarıdaki kurala uyarak önce sorar.
- Uygulama belirteçleri, anahtarlar ve ayrılmış URL'ler veritabanında değil ayrı bir dosyada tutulur ve arayüzde ile günlüklerde maskelenir.
- macOS artık bir anahtar zinciri istemi göstermez: Modelflare oturumu, diğer kimlik bilgileri gibi dosya izinleriyle korunur.
- Modelflare'de oturum açma veya bağlanma başarısız olunca mesaj gerçek ağ nedenini adlandırır.
- Pencereyi Keşfet sayfasındaki boş alandan sürükleyebilirsin.
- Yeni bir grup sohbetindeki rehber artık üç kısa ipucu ve iki veya üç başlangıçtır; bir başlangıcı giriş kutusuna koymak için tıkla.
- Yeni bot sayfasındaki model ayarları bot ayarlarındaki Model grubuna benzer ve Oluştur düğmesi form kadar geniştir.
- Avatar menüsündeki Geri bildirim altındaki not gitti.

## 0.1.30 - 2026-11-10

### Yeni

- **Bot kredisi:** Modelflare bot kredisi olan hesaplar sol alt köşede bir halka ve kalan yüzdeyi görür. Bot kredini, hesap bakiyeni ve Bakiye yükle bağlantısını görmek için tıkla. Bot kredisi yalnızca AnyModelBot'ta kullanılabilir ve uygulamanın verdiği anahtarlardan gelen istekler önce onu kullanır. Sayılar kartı açınca ve her mesaj işlendikten sonra yenilenir. Bot kredisi olmayan hesaplar köşeyi eskisi gibi görür.
- **Yeni hesaplara 1 $ bot kredisi:** Oturum açma sayfası ve API anahtarı sayfası artık kaydolma kredisinden söz eder. Modelflare abonelikleri, bot kredisi kartının da açıkladığı gibi, planın %10'u değerinde bot kredisi ekler.
- **Yenilikler:** Bir güncellemeden sonra ilk açılış neyin değiştiğini gösterir ve her sürümde aşağı kaydırabilirsin. Kenar çubuğundaki yeni sürüm bildirimine tıklamak önce yeni sürümün notlarını gösterir, böylece indirmeden veya yeniden başlatmadan önce karar verebilirsin. Değişiklik günlüğü her zaman Ayarlar → Hakkında içindedir.
- **Masaüstü çalışma alanı olarak resmi botlar:** Company Research, PPT Master, Film Studio ve US Stock Research işini solda bir listede, içeriği sağda gösterir. Yeni kısa bir yönlendirmeli form başlatır. Üst çubuk Çalışma alanı ile Sohbet arasında geçer; Sohbet'te tam konuşmayı görürsün. US Stock Research temel sayıları grafikleştirir, Film Studio'da resim, video ve ses şeritli bir storyboard vardır ve PPT Master önizlemelerde sayfa sayfa gezmeni sağlar.
- **Kendi arayüzü olan botlarda model seçimi:** Giriş kutusu olağan bir sohbet gibi çalışır; model seçici, + menüsü ve eğik çizgi komutları vardır.
- **Aramada son sohbetler:** Yazmadan önce arama iletişim kutusu son sohbetleri Bugün, Dün, Önceki 7 gün ve Daha önce olarak gruplar.

### İyileştirmeler ve düzeltmeler

- WeChat QR oturum açma: telefonda gösterilen kodu isteyince kod yaklaşık yarım dakika sonra değil hemen denetlenir. Yanlış bir kod bunu söyler ve çok fazla yanlış kod yeni bir QR kodu getirir.
- Hesap menüsü hesap alanı kadar geniştir ve üzerine gelmek yalnızca avatarı koyulaştırır. Ayarlar gezinmesi kenar çubuğunu doldurur ve hesap alanı alta sabitlenir.
- Kendi arayüzü olan botlardaki başlangıçlar tek satırlık çip sırasıdır; uzun olanı sonuna kadar okumak için üzerine gel.

## 0.1.29 - 2026-11-09

### Yeni

- **Kendiliğinden güncelleme indirmeleri, varsayılan olarak açık:** Kurulu masaüstü uygulamaları yeni sürümleri arka planda indirir, sonra kenar çubuğunda ve Ayarlar → Hakkında içinde Yeniden başlat ve güncelle sunar. Elle indirmek için kendiliğinden indirmeleri Ayarlar → Genel içinde kapat.
- Kurulum senin tıklamanı ister ve etkin sohbetin veya arka plan görevin kalmayana kadar bekler. Olağan çıkışlar güncellemeleri kendiliğinden kurmaz.
- 0.1.28 veya daha eskisinde olanlar uygulama içi güncellemeleri kullanmadan önce bu sürümü bir kez elle kurmalıdır. macOS, Windows ve Linux AppImage'da desteklenir; Docker ve kaynak kurulumları hâlâ elle güncellenir.
- **Oturum açtıktan sonra uygulamaya dönüş:** Tarayıcıda onayladıktan sonra sayfa, oturum açtığını söylemeden önce uygulama gerçekten bağlanana kadar bekler, sonra seni AnyModelBot'a geri götürür. Bir şey başarısız olursa nedenini söyler. API anahtarı sayfası da bunun yerine bir Modelflare hesabıyla oturum açmanı sağlar.
- **İlk oturumun için seçilen bir model:** Henüz varsayılan modelin yoksa uygulama araç destekleyen düşük maliyetli bir model seçer (önce DeepSeek), böylece deneme kredisi birkaç tipik görevi karşılar. Hiçbiri uymazsa nedenini açıklar ve seçmene izin verir.
- **macOS Bilgisayar kullanımı izinleri yalnızca gerektiğinde istenir:** Bir bot Erişilebilirlik veya Ekran Kaydı izni olmadan ilk kez tıklamaya, yazmaya veya ekrana bakmaya gerek duyunca o tur durur ve sohbet hangi iznin eksik olduğunu, istemek, eşleşen ayarlar sayfasını açmak ve yeniden denetlemek için düğmelerle söyler. Uygulamanın yeniden açılması gerekiyorsa gönderilmemiş taslaklar tutulur.
- **Keşfet kapakları:** Resmi botların artık açık veya koyu temayı izleyen çizimli kapak sahneleri vardır ve öne çıkan botlar büyük kartlar olarak görünür.

### İyileştirmeler ve düzeltmeler

- Daha açık hata mesajları: düşük bakiye, süresi dolmuş kimlik bilgileri, kullanılamayan modeller, hız sınırları ve ağ başarısızlıklarının her birinin kendi açıklaması ve Bakiye yükle veya model değiştirme gibi eşleşen bir eylemi vardır. Ham hata Hata ayrıntıları altında durur ve gizli bilgiler çıkarılmış olarak kopyalanabilir. Aynı hata artık iki kez açılmaz, kenar çubuğu yalnızca “Başarısız: neden” gösterir ve Yeniden gönder tüm görevin baştan çalışacağı konusunda uyarır. Şirket araştırması botu görev hatalarını aynı şekilde katlar.
- Sol alttaki hesap alanı her zaman bakiyeni ve bir Bakiye yükle bağlantısını gösterir ve düşük bakiye ayrı bir uygulama içi bildirim yerine orada işaretlenir. Menüsünde geri bildirim, güncelleme denetimi ve oturumu kapat vardır; görevler çalışırken oturumu kapatmak önce sorar. Kendi API anahtarınla buradan Modelflare'de oturum açabilir ve anahtarlarını ile ayarlarını tutabilirsin.
- Başlangıç denetim listesi: “Alışık olduğun sohbet uygulamasını bağla” bir kanal seçmeni ve ayarlarını açmanı sağlar ve yalnızca gerçekten bağlanınca sayılır. “Merhaba de” gerçek bir yanıt ister. “Anımsa …” dedikten sonra denetim listesi saniyeler içinde güncellenir. Bir taslağın varken veya bir görev çalışırken rehber artık açılmaz ve her şey bitince denetim listesi katlanır.
- Bir anahtarı değiştirdikten veya model kaynağını değiştirdikten sonra uygulama var olan botlarının modellerini denetlemeni anımsatır. İlk kurulumda sessiz kalır.
- Bot ayarlarını art arda birkaç kez kaydetmek tek bir “Kaydedildi” gösterir. Yeni botlar devralınan varsayılan görünürken model ayarlarını katlı tutar ve artık listedeki ilk modeli sessizce seçmez. Çok botlu bir grup oluşturmak nasıl çalıştığını, üyelerine dayalı örnek istemlerle açıklar.
- Arama sırasında Keşfet'e tıklamak seni Keşfet'e geri götürür.
- Kendi arayüzü olan botlar (şirket araştırması, PPT Master, film stüdyosu, ABD hisse araştırması) artık olağan sohbetlerle aynı yazma alanını kullanır. Başlangıçlar bir kart sırasıdır, böylece uzun olanlar artık kesilmez. En son yanıt Markdown olarak işlenir, uzun yanıtlar genişletilebilir ve tam sohbeti açabilirsin.
- Daha sade bir arayüz: daha az ayırıcı çizgi ve kenarlık, dolgulu giriş alanları ve kenar çubuğunda sabit Seni bekliyor ve Keşfet satırları; bir sayım yerine mavi bir nokta (sayım hâlâ ipucunda ve ekran okuyucular içindir).
- Daha temiz bot avatarı kenarları: koyu arka planlarda avatarların çevresindeki açık saçak gitti ve küçük avatarlar artık kendi boyutlarına göre önceden ölçeklenmiş görüntüler kullanır, böylece kenarlar daha pürüzsüz görünür.
- macOS kurucuları yayından önce bir Developer ID imzası ve Apple noter onayı için denetlenir ve denetimlerden biri başarısız olursa yayınlanmaz.

## 0.1.28 - 2026-11-08

### Yeni

- **Resmi botlar uygulamayla gelir:** Company Research, PPT Master, Film Studio ve US Stock Research arayüzlerini, örneklerini, kişiliklerini ve becerilerini kurucuya koyar. İlk önizleme ve kurulum bot paketi indirmesi gerektirmez. Model çağrıları ve çevrimiçi araştırma yine bir ağ bağlantısı ister.

### İyileştirmeler ve düzeltmeler

- Kesilen katalog botu içeriği ve eksik kaydırma düzeltildi. Giriş kutusu artık içeriği örtmez ve yükseltmeler var olan projeleri ve veriyi korur.
- Sürüm derlemeleri, sağlama dosyalarını alırken ağ zaman aşımlarını azaltmak için Electron'un paketlenmiş sağlama verisini yeniden kullanır ve tam karma doğrulamasını korur.
- Hem Intel hem Apple silicon için GitHub macOS derlemeleri, bilinen HTTP/3 bağlantı kopmalarını aşmak için Apple hizmetlerinde artık TCP'ye döner. İmzalama, zaman damgaları ve noter onayı gerekli kalır.

## 0.1.27 - 2026-11-08

### Yeni

- **Resmi botlar uygulamayla gelir:** Company Research, PPT Master, Film Studio ve US Stock Research arayüzlerini, örneklerini, kişiliklerini ve becerilerini kurucuya koyar. İlk önizleme ve kurulum bot paketi indirmesi gerektirmez. Model çağrıları ve çevrimiçi araştırma yine bir ağ bağlantısı ister.

### İyileştirmeler ve düzeltmeler

- Kesilen katalog botu içeriği ve eksik kaydırma düzeltildi. Giriş kutusu artık içeriği örtmez ve yükseltmeler var olan projeleri ve veriyi korur.
- Sürüm derlemeleri, sağlama dosyalarını alırken ağ zaman aşımlarını azaltmak için Electron'un paketlenmiş sağlama verisini yeniden kullanır ve tam karma doğrulamasını korur.
- GitHub Intel Mac derlemeleri, bilinen HTTP/3 bağlantı kopmalarını aşmak için Apple hizmetlerinde artık TCP'ye döner. İmzalama, zaman damgaları ve noter onayı gerekli kalır.

## 0.1.26 - 2026-11-08

### Yeni

- **Resmi botlar uygulamayla gelir:** Company Research, PPT Master, Film Studio ve US Stock Research arayüzlerini, örneklerini, kişiliklerini ve becerilerini kurucuya koyar. İlk önizleme ve kurulum bot paketi indirmesi gerektirmez. Model çağrıları ve çevrimiçi araştırma yine bir ağ bağlantısı ister.

### İyileştirmeler ve düzeltmeler

- Kesilen katalog botu içeriği ve eksik kaydırma düzeltildi. Giriş kutusu artık içeriği örtmez ve yükseltmeler var olan projeleri ve veriyi korur.
- Sürüm derlemeleri, sağlama dosyalarını alırken ağ zaman aşımlarını azaltmak için Electron'un paketlenmiş sağlama verisini yeniden kullanır ve tam karma doğrulamasını korur.

## 0.1.25 - 2026-11-08

### Yeni

- **Resmi botlar uygulamayla gelir:** Company Research, PPT Master, Film Studio ve US Stock Research arayüzlerini, örneklerini, kişiliklerini ve becerilerini kurucuya koyar. İlk önizleme ve kurulum artık bot paketi indirmez; güncellemeler uygulama sürümleriyle gelir. Model çağrıları ve çevrimiçi araştırma yine bir ağ bağlantısı ister.

### İyileştirmeler ve düzeltmeler

- Katalog botu içeriğinin üstte kısa bir şeride kesilmesi, kaydırmasız büyük bir boş alan bırakması düzeltildi. İçerik artık kullanılabilir alanı doldurur ve giriş kutusu onu örtmez.
- Uygulama yükseltmeleri var olan bot projelerini ve veriyi korur ve güncellenmiş arayüze yalnızca hazır olduktan sonra geçer; boş bir görünüm önlenir.

## 0.1.24 - 2026-11-07

### Yeni

- **ZIP'ten beceri içe aktar:** Bot ayarları → Beceriler içinde `SKILL.md` içeren bir ZIP içe aktar, adını ve açıklamasını önizle, sonra ekle. Becerileri görüntüle, aç, kapat veya sil ve aynı adı yeniden içe aktarırken değiştirmeyi onayla. Betikler, başvurular ve varlıklar korunur.
- **Sohbet geçmişinde ara:** Kenar çubuğundan bu cihazda tutulan mesajlarda ara, bota, sohbete, kanala veya tarihe göre süz ve özgün mesaja atla. `Ctrl/Cmd+Shift+F` genel aramayı açar; `Ctrl/Cmd+F` henüz yüklenmemiş geçmiş dahil geçerli sohbeti arar. Arama model çağrısı yapmaz.
- Beceriler her bot için ayrı yönetilir ve değişiklikler bot boştayken uygulanır. Değiştirme açık durumu korur, silme çalışma alanı çıktısını tutar ve içe aktarılan paketler yerleşik veya katalog botu becerilerinin üzerine yazamaz.

## 0.1.23 - 2026-11-06

### Yeni

- Kısa videolar, bölümlü diziler, varlık kitaplıkları, storyboard'lar, tuvaller, anlatım, altyazılar ve yerel işleme için Film Studio katalog botu eklendi. Yaratıcı kurallar ve kompozisyon motoru PRINTFILM'den (MIT) taşındı.
- Katalog botları ses/video önizleyebilir ve ortam çekimlerini tutabilir. Dayanıklı üretim kimlikleri, kesilen işin özgün görevi kendiliğinden yeniden göndermeden geri almasını sağlar.
- Keşfet'te bot indirmeleri geri geldi. Yenilenmiş katalog imzalama anahtarını kullanmak için 0.1.23'e güncelle.

## 0.1.22 - 2026-11-04

### Yeni

- **Kendi resmi API anahtarlarını kullan:** Artık bir hesap gerekmez. İlk açılışta Kendi API anahtarını kullan'a tıkla veya Ayarlar → Modeller'e git ve OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax veya Mistral'den bir anahtar gir. Model istekleri doğrudan sağlayıcıya gider, sağlayıcı sana fatura keser ve anahtar bu cihazda kalır. Görüntü ve video üretimi hâlâ yalnızca Modelflare üzerinden kullanılabilir.
- **Web araması için Keenable:** Ayarlar → Ağ ve erişim içinde seç ve bir anahtar gir.

### İyileştirmeler ve düzeltmeler

- Ayarlar'daki Modelflare sekmesi artık Modeller adını taşır ve oturum açmadıysan orada Modelflare'de oturum açabilirsin.
- Company Research, US Stock Research ve PPT Master artık Japonca, Korece ve Rusçayı destekler.

### Gizlilik

- Yalnızca resmi API anahtarlarıyla ve oturum açmadan uygulama Modelflare'in hesap verisini veya fiyat kataloğunu okumaz. Yerleşik ağ geçidi genel model kataloğunu models.dev adresinden okur ve o istek anahtar veya sohbet içeriği taşımaz.

## 0.1.21 - 2026-11-03

### Yeni

- **Daha kolay kanal kurulumu:** Ayarlar'daki Bağlantılar yeniden kuruldu. Her uygulama nasıl bağlanacağını gösterir, böylece bir kod taramak veya bir belirteç girmek için adımları izlemen yeter. Bağlantıyı bitirmek için hâlâ bir ilk mesaj bekliyorsa bunu söyler. Aynı uygulama için daha çok hesap da ekleyebilirsin.

### İyileştirmeler ve düzeltmeler

- **Daha açık bot silme:** Onay artık o botun sohbet kanallarına sonra hangi botun yanıt vereceğini söyler. Son botunsa o mesajların yanıt almayacağı konusunda uyarır.
- **Keşfet botlarını kaldırma:** Aynı onaydaki bir onay kutusu botun verisini tutmanı sağlar.
- **Daha sade görünüm:** Pencere arka planında artık bir parıltı yok, eylemler nötr renkler kullanır ve yazı boyutları artık yarım piksel kullanmaz, böylece metin Windows'ta daha keskindir.
- **Bakiye uyarısı:** Bakiyen düşünce kenar çubuğu yalnızca bunu söyler. Tutarı görmek için avatarını seç.
- **Buzlu cam sistemini izler:** Ayar gitti ve uygulama artık sisteminin saydamlığı azalt ayarını izler.
- Bir bot oluştururken kenar çubuğu yazdıkça avatarını ve adını gösterir ve bitince artık başka bir bota yanıp sönmez.
- Açılır menüler artık sayfa kaydıkça onu izler ve Keşfet düzeni inceltilmiştir.

## 0.1.20 - 2026-11-03

### Yeni

- **Keşfet:** Kenar çubuğunda artık Keşfet vardır; her birinin kendi görünümü olan hazır botlarla. Birini açmak bir örnek gösterir ve yalnızca ilk mesajını gönderince kurulur. İstediğin zaman kaldır.
- **Company Research:** Bir şirket adı ver; mali durumu, haberleri, sektörü ve işi araştırır, sonra temel olgular için kaynak bağlantılı bir rapor yazar. Python kuruluysa bir PDF dışa aktarabilir.
- **US Stock Research:** SEC kayıtlarından araştırma raporları yazar; her sayı izlenebilir.
- **PPT Master:** Belgeleri veya konuları düzenlenebilir PPTX destelerine çevirir ve şablon da yapabilir veya elindeki desteleri düzenleyebilir. Python ister.
- **12 uzman avatarı:** Avatar seçicide artık hukuk, sağlık, finans, kodlama ve tasarım dahil 12 alan için karakterler vardır.

### Gizlilik

- Başlangıçta ve her 6 saatte bir uygulama bot kataloğunu anymodel.bot'tan okur ve bir botun paketini onu açınca veya kullanınca indirir. Bu istekler yalnızca indirir; verin yüklenmez. Kataloğu kapatmak için `AMB_CATALOG=off` ortam değişkenini ayarla.

## 0.1.19 - 2026-11-03

### Önemli değişiklikler

- **Oturum açmak artık gerekli:** Bir API anahtarı yapıştırmak artık desteklenmez; herkes bir Modelflare hesabıyla oturum açar. Güncelledikten sonra daha önce girdiğin herhangi bir anahtar bu cihazdan kaldırılır ve uygulama oturum açmanı ister. Bunu yapınca botların ve sohbetlerin çalışmaya devam eder.
- **Oturum açma artık Docker'da ve uzak kurulumlarda çalışır:** Herhangi bir cihazdaki bir tarayıcıdan oturum aç, sonra adres çubuğundaki bağlantıyı uygulamaya geri yapıştır. Komut satırı kurulumu sırasında `remote` gir.

### Yeni

- **Akıl yürütme çabası:** Otomatik, Düşük, Orta veya Yüksek seç. Daha yüksek ayarlar daha çok düşünür ve daha yavaş yanıtlar. Otomatik ile modele karar verir ve ayarlayamayan modeller etkilenmez.
- **Bir modeli denerken daha çok ayrıntı:** Sorun giderme artık yerleşik ağ geçidi ve doğrudan uç nokta için sonuçları ayrı gösterir; durum kodu, geçen süre ve özgün hatayla.

### İyileştirmeler ve düzeltmeler

- Model listesi uç noktası yanıt vermezse uygulama 30 saniye sonra beklemeyi bırakır, böylece “Modeli dene” artık sonsuza kadar dönmez.
- Sitenin iş ortağı sayfası, ana sayfası ve indirme sayfası güncellendi.

## 0.1.18 - 2026-11-03

### Yeni

- Bu sürüm tam beş dil desteği, elle API etki alanı seçimi ve gecikme denetimleri, güncelleme anımsatmaları, yerel vekil sunucu tanıları ve site, indirme ve iş ortağı sayfası güncellemelerini içerir. Özellik ayrıntıları için aşağıdaki 0.1.17 bölümüne bak.

### Düzeltildi

- CRLF satır sonu kullanan Windows çıkışlarında yol haritası içeriğini yanlış tanıyan bir belge denetimi düzeltildi. Gerileme testleri artık LF, CRLF ve CR kapsar. Bu düzeltme uygulama davranışını değiştirmez.

## 0.1.17 - 2026-11-03

### Yeni

- **Beş dil:** Japonca, Korece ve Rusça, Basitleştirilmiş Çince ve İngilizceye uygulamada, sistem tepsisinde, sistem mesajlarında, yetkilendirme istemlerinde, sitede ve belgelerde katılır. Dili başlangıç sırasında, Ayarlar'da veya komut paletinden değiştir.
- **API etki alanları ve gecikme denetimleri:** `modelflare.dev`, `origin.modelflare.dev` veya `cf.modelflare.dev` arasından elle seç ve yanıt sürelerini uygulamayı çalıştıran cihazdan karşılaştır. Denetimler API anahtarı göndermez, model çağrısı yapmaz ve etki alanlarını hiç kendiliğinden değiştirmez.
- **Güncelleme anımsatmaları:** Kenar çubuğu ve Hakkında sayfası kullanılabilir güncellemeleri gösterir. İndirme sayfasını aç veya o sürüm için anımsatmayı kapat.
- **Site iş ortağı sayfası:** İş ortaklıklarını öğren ve bir başvuru doldur. Bir gönderme uç noktası olmadan form, başvurunun gönderildiğini iddia etmek yerine açıkça e-posta kullanır.

### İyileştirildi ve düzeltildi

- Çeviri dosyaları modüle göre düzenlenir. Sürüm denetimleri eksik içeriği, yer tutucuları, çoğulları ve belge bağlantılarını doğrular. Rusça çoğullar, yerelleştirilmiş tutarlar ve tarihler, Japonca ve Korece giriş yöntemleri ve mobil satır sonları iyileştirildi.
- Feishu ve Notion yetkilendirme hataları geçerli dili izler. Yerel bir vekil sunucuya reddedilen bağlantılar artık özgün hatayı korurken uygulanabilir rehber içerir.
- Sitenin gökyüzü etkileri, indirme sayfası ve mobil düzenleri incelendi; yerelleştirilmiş paylaşım görüntüleri, arama motoru dil ek açıklamaları ve 404 sayfalarıyla.

## 0.1.16 - 2026-11-02

### Yeni

- **Grup sohbetleri:** İki veya daha çok botla kenar çubuğundaki ＋ düğmesine tıklayarak bir grup sohbeti oluştur ve birkaç botla birden konuş. Kimi @lersen o yanıtlar; @ yoksa son yanıtlayan bot sürdürür. Botlar devretmek için başka bir üyeyi de @leyebilir. Her bot kendi modelini, çalışma alanını ve belleğini korur ve maliyetler bot başına izlenir.

### Değişti

- **Bakiye yoldan çekilir:** Sol alt köşe artık yalnızca avatarını, adını ve ayarlar düğmesini gösterir. Bakiyeni görmek ve bakiye yüklemek için avatara tıkla. Bakiyen uyarı düzeyinin altına düşünce yine bir kenar çubuğu anımsatması alırsın.

## 0.1.15 - 2026-11-02

### Yeni

- **Tüm botların paylaştığı hesaplar:** Sohbet ve Notion hesaplarını Ayarlar › Bağlantılar içinde bir kez ekle ve her bot onları kullanabilsin. Her hizmetin kendi takma adlı birkaç hesabı olabilir.
- **Bir sohbetten bot değiştir:** Botlarını görmek için bir sohbet uygulamasında `/bot` gönder ve geçmek için bir kez `/bot name`. O sohbet yeni botta kalır, böylece her mesajda yinelemezsin. Her bot diğerlerini de bilir, bu yüzden sorduğunda yanıtlayabilir.
- **Telegram, Slack ve Discord:** Bağlamak için bir belirteç yapıştır. Genel bir adres gerekmez ve görüntü ile dosya iki yönde de çalışır.
- **Notion:** Tek tıklama yetkisi veya bir belirteçle bağla. Botlar sayfa arayabilir, okuyabilir, oluşturabilir ve düzenleyebilir ve veritabanlarını sorgulayabilir. Sayfa silemezler.
- **Feishu mesajlarını oku:** Bir QR koduyla yetkilendir, sonra herhangi bir bottan “ikinci Feishu'ma bak” de. Sohbetleri okur ve mesajları sen olarak, salt okunur arar.
- **Tarayarak Feishu ekle:** Bir Feishu sohbet hesabı eklerken bir App ID ve Secret girmek yerine uygulamayı oluşturmak için bir QR kodu tara.

### İyileştirildi

- **Web araması artık bir DeepSeek anahtarı istemez:** Varsayılan olarak ücretsizdir ve Tavily, Exa, Bocha, Zhipu veya kendi SearXNG'ne geçebilirsin.
- **Karakterler rollerden ayrıdır:** Bir avatar yalnızca bir botun görünüşünü ayarlar ve bir şablon seçmek onu değiştirmez.

### Değişti

- Sohbet kanalı kurulumu her botun bilgi panelinden Ayarlar › Bağlantılar'a taşındı. Var olan hesaplar yeni bir oturum açma olmadan kendiliğinden taşınır ve aynı bot varsayılan olarak hâlâ yanıtlar.
- Sahipler ve izin listeleri artık hesaba aittir, bu yüzden onda izinli herkes herhangi bir botla konuşabilir. Bir botu silmek artık hesapları etkilemez.
