# Katkıda bulunma

[简体中文](./CONTRIBUTING.md) | [繁體中文（台灣）](./CONTRIBUTING_zh-TW.md) | [English](./CONTRIBUTING_en.md) | [日本語](./CONTRIBUTING_ja.md) | [한국어](./CONTRIBUTING_ko.md) | [Русский](./CONTRIBUTING_ru.md) | [Español](./CONTRIBUTING_es.md) | [Português (Brasil)](./CONTRIBUTING_pt.md) | Türkçe

AnyModelBot'u geliştirmeye yardım ettiğin için teşekkürler. Hata bildirimleri, düzeltmeler, belgeler ve fikirler hoş gelir.

## Sorular ve geri bildirim

- **Sorular, fikirler, göstermek istediklerin:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Hatalar ve özellik istekleri:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues), şablonları kullanarak
- **Toplulukla sohbet:** [Discord](https://discord.gg/umBN6wX3zJ) · [Telegram](https://t.me/+Tx6Payfzxqk2ZGVl)
- **Güvenlik sorunları:** açık bir issue açma; [güvenlik politikasında](./SECURITY_tr.md) anlatıldığı gibi özel olarak bildir
- **Başka her şey:** [support@anymodel.bot](mailto:support@anymodel.bot) adresine e-posta gönder

Bir hata bildirirken şunları ekle:

- Sürüm (Ayarlar → Hakkında), işletim sistemin ve mimarin (örneğin Windows 11 x64, macOS 15 Apple silicon) ve nasıl çalıştırdığın (masaüstü / komut satırı / Docker)
- Yeniden üretme adımları, ne beklediğin ve ne olduğu
- Tanı: Ayarlar → Sorun giderme → “Tanıyı kopyala” (API anahtarları ve belirteçler `***` ile değiştirilir). Günlükler veri klasörünün içindeki `logs/app.log` dosyasındadır; yerini [docs/privacy_tr.md](./docs/privacy_tr.md#veri-klasörü) içinde gör
- Sorun belirli bir modele aitse model kimliği

## Geliştirme kurulumu

Node.js 22.13+ ve Go 1.26.8+ gerekir (paketlenmiş magpie ağ geçidini derlemek için).

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # vendor/magpie alt modülünü alır ve build/bin/ içine derler
```

| Komut | Ne yapar |
| :--- | :--- |
| `npm start` | Komut satırından çalıştırır: ağ geçidi + botlar + konsol `http://127.0.0.1:3600/` adresinde |
| `npm run dev` | Aynı, kod değişince yeniden başlar |
| `npm run electron:dev` | Geliştirme modunda masaüstü uygulaması |
| `npm run electron:smoke` | Masaüstü duman testi (başlıksız Linux'ta xvfb-run kullanır) |
| `npm run typecheck` | TypeScript tür denetimi |
| `npm test` | Birim testleri + çevrimdışı uçtan uca + ağ geçidi bütünleşme testleri |
| `npm run test:dsh-bundle` | Electron altında gerçek DSH bütünleşme testi (önce `prepare:dsh` + `bundle:dsh` çalıştır) |
| `npm run docs:check` | README öz denetimi |

Depo düzeni, paketleme ve kanal kurulumu [geliştirme kılavuzunda](./docs/development_tr.md) anlatılır.

## Dallar ve pull request'ler

1. Depoyu forkla ve `master` üzerinden bir dal oluştur.
2. Göndermeden önce şunu çalıştır:

   ```bash
   npm run typecheck && npm test
   ```

   README veya `docs/` değiştiyse `npm run docs:check` de çalıştır.
3. `master` hedefine bir pull request aç; neyin değiştiğini, nedenini ve nasıl doğruladığını yaz. Arayüz değişikliklerinde ekran görüntüsü ekle.
4. Küçük bir düzeltmeden büyük her şey için (yeni özellikler, mimari değişiklikler, yeni bağımlılıklar) önce bir issue aç ki zaman ayırmadan önce yaklaşımda anlaşalım.
5. Her PR'de tek bir değişiklik tut; mevcut commit biçimini izle (`feat(scope): …`, `fix(scope): …`).

## Arayüz değişiklikleri

- `ui/design` içindeki belirteçleri ve bileşenleri kullan (`ui/design/README.md`); tek seferlik renk veya yazı boyutu ekleme.
- Marka vurgu rengi floresan sarı-yeşil `#d7ff00`; arayüze mavi sokma.
- Konsol, derleme adımı olmayan Preact + htm kullanır; paketleyici veya derlenmesi gereken ön yüz bağımlılığı ekleme.
- Hem açık hem koyu temayı kontrol et.
- Arayüz metinlerini `t()` ile göster. Bildirim dosyasında listelenen her dil için çevirileri `ui/locales/<dil>/` altına ekle. Geleneksel Çince (Tayvan) için `zh-TW` kullan. Değişiklikleri göndermeden önce `npm run i18n:check` çalıştır.

## Üçüncü taraf kod ve bağımlılıklar

- Bir bağımlılık eklediğinde veya dış kodu taşıyıp uyarladığında `THIRD_PARTY_NOTICES.md` dosyasını kaynak, sürüm ve lisansla güncelle.
- MIT dağıtımıyla uyumsuz lisanslı bileşenler ekleme; AGPL, SSPL veya FSL gibi.

## Davranış kuralları

Nazik ol ve olgulara bağlı kal. Her katılımcıya saygı göster, kişileri değil fikirleri eleştir; taciz, kişisel saldırı ve ayrımcı dil kabul edilmez. Beklentileri karşılamayan içeriği bakımcılar kaldırabilir. Bir kaygıyı iletmek için [support@anymodel.bot](mailto:support@anymodel.bot) adresine yaz.

## Lisans

Gönderdiğin katkılar bu deponun [MIT Lisansı](./LICENSE) altında yayınlanır.
