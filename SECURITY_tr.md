# Güvenlik politikası

[English / 简体中文](./SECURITY.md) | [繁體中文（台灣）](./SECURITY_zh-TW.md) | [日本語](./SECURITY_ja.md) | [한국어](./SECURITY_ko.md) | [Русский](./SECURITY_ru.md) | [Español](./SECURITY_es.md) | [Português (Brasil)](./SECURITY_pt.md) | Türkçe

## Bir açığı nasıl bildirirsin

Bir güvenlik sorunu için **açık** bir issue, tartışma veya pull request açma.

Şu yollardan biriyle özel olarak bildir:

1. **GitHub özel açık bildirimi (tercih edilen):** deponun **Security** sekmesi → **Report a vulnerability**.
2. **E-posta:** [support@anymodel.bot](mailto:support@anymodel.bot), konuda “Security” olsun.

Şunları ekle:

- AnyModelBot sürümü (Ayarlar → Hakkında), işletim sistemi ve mimari, ve nasıl çalıştırdığın (masaüstü / komut satırı / Docker)
- Sorunun ne olduğu ve bir saldırganın bununla ne yapabileceği
- Yeniden üretme adımları veya bir kavram kanıtı
- İşe yarayan günlükler veya tanılar (Ayarlar → Sorun giderme → “Tanıyı kopyala” anahtarları ve belirteçleri çıkarır)

## Sonra ne olur

1. Raporunu aldığımızı doğrularız.
2. İnceleriz ve değerlendirmemiz hakkında seni bilgilendiririz.
3. Bir düzeltme ve açıklama takviminde seninle anlaşırız, sonra düzeltilmiş bir sürüm yayınlarız.
4. İzninle, sürüm notlarında sana teşekkür ederiz.

## Desteklenen sürümler

Güvenlik düzeltmeleri en son sürüme girer. Bildirmeden önce sorunun [en son sürümde](https://github.com/modelflare-ai/AnyModelBot/releases) hâlâ durduğunu kontrol et.

## Kapsam

Kapsam içinde: bu depodaki AnyModelBot uygulaması (masaüstü uygulaması, komut satırı, bu depodan derlenen Docker imajı) ve yerel konsolu.

Burada kapsam dışı: Modelflare'in kendi hizmetleri (bunları [Modelflare Güven Merkezi](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) üzerinden bildir), WeChat ve Feishu platformları ve magpie, DeepSeek Harness, Cua gibi yukarı akış projeleri — bunları bakımcılarına bildir. Emin değilsen bize e-posta yaz, yönlendirelim.
