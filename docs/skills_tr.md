# Becerileri içe aktarma ve yönetme

[简体中文](./skills.md) | [繁體中文（台灣）](./skills_zh-TW.md) | [English](./skills_en.md) | [日本語](./skills_ja.md) | [한국어](./skills_ko.md) | [Русский](./skills_ru.md) | [Español](./skills_es.md) | [Português (Brasil)](./skills_pt.md) | Türkçe

AnyModelBot 0.1.24 ile birlikte, elindeki iş akışlarını bir bota ZIP beceri paketleri olarak ekleyebilirsin. Haftalık rapor, belge işleme ve araştırma gibi işler için kullanılır.

## İçe aktarma

1. Hedef botun ayarlarını aç, Beceriler'i bul ve ZIP içe aktar'a tıkla.
2. Yerel bir ZIP seç; adını, açıklamasını ve dosya sayısını gözden geçir. Yönergeleri sonuna kadar okumak için genişlet.
3. Beceri ekle'ye tıkla. İlgili bir görev gerektiğinde bot onu yükleyebilir.

Her ZIP bir beceri içerir. `SKILL.md` ZIP kökünde veya bir sarmalayıcı klasörün içinde olabilir. `scripts/`, `references/` ve `assets/` gibi destek dosyaları korunur. İçe aktarma GitHub'a bağlanmaz ve kurulum betiklerini kendiliğinden çalıştırmaz.

`SKILL.md` için YAML ön bilgisi ve bir yönerge gövdesi gerekir, örneğin:

```markdown
---
name: weekly-report
description: Kullanıcının iş notlarından haftalık rapor yaz.
---

Bitmiş işi, sorunları ve gelecek haftanın planını düzenle, sonra kullanıcının istediği biçimi kullan.
```

Adlar küçük İngilizce harf, rakam ve tek tire kullanır; en çok 64 karakter. ZIP dosyaları en çok 20 MB olabilir; açıldıktan sonra en çok 64 MB ve 2.000 girdi. `SKILL.md` en çok 256 KB olabilir ve her botun en çok 100 içe aktarılmış becerisi olabilir. Bir ZIP birkaç `SKILL.md` içeriyorsa her beceriyi ayrı paketle.

## Beceri kitaplığından veya GitHub'dan kurma

- Beceri kitaplığına kategoriye veya yazara göre bakmak için Uygulamalar ve beceriler içindeki Beceriler sekmesini aç; bot ayarlarındaki beceri bölümünde de Becerilere göz at vardır. “Kurulum istemini kopyala”ya tıkla ve herhangi bir bota gönder.
- Bir becerinin GitHub bağlantısını da bir bota gönderebilirsin (bir depo, bir `/tree/<branch>/<path>` klasörü veya bir `SKILL.md` dosyası) ve “bunu kur” diyebilirsin.
- Bot, becerinin adını, açıklamasını, kaynağını, lisansını ve dosya sayısını okur ve bir onay kartı gösterir. Kur'a tıklayana kadar hiçbir şey yazılmaz ve beceri yalnızca o bota kurulur. Sohbet kanallarında karttaki kodla yanıtla; Feishu kartlarında düğmeler vardır. Becerileri yalnızca sahip kurabilir.
- Kurulu beceriler listede kaynağını “GitHub · depo” olarak gösterir; Görüntüle depoyu, yolu, dalı, kurulan commit'i ve kurulum zamanını gösterir.

## Bu bilgisayardan içe aktarma (Beceri kitaplığım)

Bilgisayarınızdaki diğer araçlar için (Claude Code, Codex, Cursor, CodeBuddy gibi) zaten kurulu olan becerileri tek seferde Beceri kitaplığıma aktarıp botlarınızda açabilirsiniz.

- Nerede: avatar menüsü › Beceri kitaplığım › Bu bilgisayardan içe aktar… veya bot ayarları › Beceriler › Bu bilgisayardan içe aktar…. Arama yalnızca kitaplığın bulunduğu bilgisayardaki masaüstü uygulamasında çalışır; tarayıcıda veya uzaktan ZIP ya da GitHub bağlantısını kullanmaya devam edin.
- Altı yer otomatik olarak aranır: `~/.codebuddy/skills/`, `~/.qwenworkcn/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, `~/.cursor/skills/` ve `~/.codex/skills/`. Yalnızca klasörler ve `SKILL.md` dosya adları listelenir; talimatlar, anılar ve hesaplar okunmaz. Diğer yerler için (`~/.workbuddy/skills/`, Doubao'nun `.user_skills/` klasörü veya bir proje) Klasör seç…'i kullanın; bir projede yalnızca `.claude/skills/` gibi bilinen yerlere bakılır. Ana klasör, disk kökü ve uygulama verileri klasörünün tamamı hiçbir zaman taranmaz.
- Başta hiçbir şey seçili değildir. Beceriler yalnızca seçip İleri'ye tıkladıktan sonra okunur. Gözden geçirme her biri için şunu gösterir: içe aktarılabilir, zaten var (içerik birebir aynı; durumu korunur), aynı ad farklı içerik (varsayılan olarak atlanır; Ayrı kaydet çağrı adını korur ve görünen ada numara ekler) veya uyumsuz (nedeniyle). Betik içerenler “Betik içeriyor; içe aktarma onları çalıştırmaz”, bağımlılığı olanlar “Bağımlılıklar doğrulanmadı” olarak işaretlenir.
- Bir bottan açıldığında “İçe aktardıktan sonra {bot} içinde kullan” işaretli gelir; kitaplıktan açıldığında beceriler yalnızca kitaplığa eklenir. Sonunda eklenen, açılan, atlanan ve başarısız sayıları gösterilir. Açma başarısız olursa (aynı adlı bir beceri açık veya bot dolu), eklenen içerik kitaplıkta kalır.
- Şunlar içe aktarılmaz: özel olabilecek dosyalar (`.env`, `id_rsa`, `credentials.json`, `memory.md`…), seçilen yerin dışını gösteren bağlantılar, bu uygulamanın aynı şekilde koruyamayacağı kısıtlamalar (`allowed-tools`, `hooks` gibi), platform yol değişkenleri (`${CLAUDE_PLUGIN_ROOT}` gibi) veya başvurulan dosyası eksik beceriler. `disable-model-invocation` ve `user-invocable` olduğu gibi korunur; Codex'in `allow_implicit_invocation: false` değeri `disable-model-invocation: true` olarak yazılır.
- İçe aktarma kopyalamadır: kaynak değişmez ve eşitlenmez. Her beceri kitaplıkta tek kopya olarak durur, her bot yalnızca bir aç/kapat anahtarı tutar: bot ayarlarındaki Kitaplıktan ekle… veya anahtar yalnızca o botu etkiler. Botlara kurulan ZIP ve GitHub becerileri ile kaydettiğiniz beceriler de kitaplıkta listelenir.
- Beceri kitaplığımda bir beceriyi açarak içeriğini ve onu kullanan botları görün. İçe aktarılan bir beceri hiçbir botta açık değilse ⋯ › Kitaplıktan kaldır yalnızca kitaplıktaki kopyayı siler.

## Kullanma, değiştirme ve silme

- Bir beceri yalnızca eklediğin bota uygulanır (aşağıdaki Becerilerim'e bak). O bot aynı becerileri uygulamada ve sohbet kanallarında kullanır.
- Listede yönergeleri görüntüle, becerileri aç, kapat veya sil. Değişiklikler bot boşta kalana kadar bekler.
- İçe aktarmadan sonra onay, becerinin ne zaman hazır olduğunu söyler (sonraki mesajından, geçerli görevden sonra veya yüklendikten sonra) ve **Girişe ekle** (bu botun sohbetini açar) ile **Kopyala** içeren bir **Şunu dene** örneği gösterir. Bir düğmeyi kullanana veya kapatana kadar durur.
- Aynı adda bir beceriyi yeniden içe aktar, gözden geçir ve Beceriyi değiştir'e tıkla. Değiştirme, açık veya kapalı durumunu korur.
- Bir beceriyi silmek dosyalarını kaldırır ve çalışma alanında üretilmiş çıktıyı tutar.
- `media`, `computer-use` ve `amb-app` gibi yerleşik adlar ve katalog botlarının sağladığı beceriler, içe aktarılan paketlerle üzerine yazılamaz.

Beceriler botun mevcut izinleriyle çalışır. Python, başka bir yazılım veya bir hesap bağlantısı isteyen bir beceri o ortamı gerektirir. Başka bir istemciye özgü araçlara dayanan becerilerde değişiklik gerekebilir. Biçim uyumu, her destek aracının kurulu olduğu anlamına gelmez.

## Sohbette kullanma

- Bu botun şu an kullanabildiği beceri ve uygulamaları görmek için mesaj kutusunun solundaki **+** › **Beceriler ve uygulamalar**'a tıkla. Birine tıklayınca mesaj kutusuna “{name} kullanarak bana yardım et…” yazılır; cümleyi bitirip gönder. Botun kullanıp kullanmayacağına kendisi karar verir.
- Ayarlarda her becerinin adının yanında **Etkin**, **Sonraki mesajından itibaren hazır** veya **Yükleniyor** yazar; altında bir **Şunu dene** satırı vardır. O satıra tıklayınca örnek bu botun mesaj kutusuna gelir.
- Bot bir beceri veya uygulama kullanırken, yanıtının üstündeki süreç “Beceri kullanılıyor · {name}” gösterir; uygulamalarda her araç için bir satır: “{app} kullanılıyor · {tool}” (uygulama bir görünen ad veriyorsa onunla). Yanıt bitince bu, her adımı görmek için açabileceğin tek satıra katlanır: “Kullanıldı: …”.
- Bota “Hangi becerilerin var?” veya “Hangi uygulamaların var?” diye sor; şu an kullanabildiklerini, her biri gönderilebilecek bir örnekle listeler.
- `SKILL.md` dosyasında `disable-model-invocation: true` olan bir beceriyi bot kendiliğinden kullanmaz ve **Beceriler ve uygulamalar** içinde görünmez. Kullanmak için bir mesaja `/skill-name` yaz.

## Yaptığını beceri olarak kaydetme

Bir bot bir şeyi doğru yaptığında, nasıl yaptığını Becerilerim'e kaydedebilir, bir sonraki sefere kullanabilir veya bir zamanlamaya koyabilirsin.

- Başlangıç: giriş kutusunun + menüsünden “Beceri olarak kaydet…”i seç, `/skill` gönder veya yalnızca “beceri olarak kaydet” de. Yalnızca bir kısmını tutmak için “3. adımı beceri olarak kaydet” de. Bot hâlâ yanıtlıyorsa bu turun bitmesini bekler.
- Bot “Beceri hazırlanıyor…” der, sonra bir taslak kart gösterir: başlık ve dosya adı, ne zaman kullanılacağı, adımlar, düzelttiklerin (öğelerin işaretini kaldırabilirsin), kullandığı uygulamalar ve beceriler ve “Şunu dene”. “Düzenle” beceri dosyasının kendisini açar ve bitirdiğinde yeniden denetler. Kaydet'e tıklayana kadar hiçbir şey yazılmaz; kart 30 dakika sonra sona erer.
- Gizli bilgiler (API anahtarları, belirteçler, parolalar, doğrulama kodları, çerezler, kimlik numaraları) beceriye hiç yazılmaz; düzenlerken geri eklersen de kaydedilemez. Telefon numaraları, e-postalar, adlar, grup adları ve çalışma alanı dışındaki dosya yolları vurgulanır ve varsayılan “Her seferinde sor” olur: yer tutucuya döner ve bot her kullanımdan önce sana sorar. Özgününü beceriye yazmak için “Tut”u seç.
- Bitmemiş bir görevi de kaydedebilirsin: taslak nerede takıldığını söyler ve beceri bir kez başarıyla tamamlanana kadar “Doğrulanmadı” olarak işaretlenir.
- Başlık uyuşursa veya bot bunun aynı görev olduğunu görürse kart kaç yerin değiştiğini gösterir ve “Güncelle” veya “Yeni olarak kaydet” sunar. Güncelleme önceki sürümü tutar; Yönet altında geri yükleyebilirsin.
- Becerilerim, yalnızca bu bilgisayarda tutulan tek bir listedir; en çok 100 beceri, her botun içe aktardığı becerilerden ayrı sayılır. Bir beceri başlangıçta yalnızca onu kaydeden botta açıktır; başka bir botta kullanmak için o botun beceri listesindeki anahtarını aç. Becerileri yalnızca sahip kaydedebilir; WeChat veya Feishu grubundan kaydedilemez.
- Beceri listesinde Becerilerim satırlarında “Görüntüle” ve “Yönet” vardır. Yönet, bir ZIP dışa aktarmanı (yalnızca bu becerinin kendi dosyaları; kişisel bilgi tutuyorsa bir anımsatma), önceki sürümü geri yüklemeni veya silmeni sağlar. Dışa aktarılan bir ZIP başka bir bilgisayarda yerel ZIP becerisi olarak içe aktarılabilir.
- Kaydettikten sonra “Zamanla”, botun bir saat sormasını ve her zaman en son sürümü çalıştıran bir “Bir görev yap” kuralı oluşturmasını sağlar. Bilgisayar kullanımı, görüntü veya video üretimi ya da arka plan görevleri isteyen beceriler ve doğrulanmamış beceriler zamanlanamaz. Beceri silinirse, o bot için kapatılırsa veya bir güncelleme ya da geri yüklemeden sonra yeni yanıtlar isterse, zamanlanmış çalışmaların yapamayacağı adımlar kazanırsa ya da doğrulanmamış olursa kural duraklar ve Zamanlanmış içinde İlgini bekliyor altında görünür.
- 10 beceriden fazla olunca listeye bir arama kutusu ve “Tümü / Becerilerim / GitHub / Yerel ZIP / Kapalı” süzgeçleri gelir. Etkinlik satırındaki beceri adları becerinin ayrıntılarını açar.

## Depolama

Açılmış paketler veri klasöründe `skills/<bot ID>/` altında durur. Açık beceriler çalışma zamanı için `dsh/<bot ID>/skills/` içine kopyalanır. İçe aktarma yalnızca kullandığın AnyModelBot örneğine yüklenir; bir sunucu kurulumunda dosyalar o sunucuda durur. Açık becerilerin adları ve açıklamaları ile kullanım sırasında yüklenen yönergeler veya başvurular, seçtiğin modele giden bağlama dönüşür. Bkz. [Veriler ve gizlilik](./privacy_tr.md).

Becerilerim, veri klasöründeki `my-skills/` içinde durur ve açık olduğu her bot için çalışma zamanında `dsh/<bot ID>/skills/` içine kopyalanır.

Bu bilgisayardan içe aktarılan beceriler veri klasöründeki `skill-library/` içinde durur ve açık olduğu her bot için çalışma zamanında `dsh/<bot kimliği>/skills/` içine kopyalanır. Bir bot silindiğinde, ona kurulu beceriler Beceri kitaplığımda kalır.
