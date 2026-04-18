# CDN:er och säkerhet
## - från global infrastruktur<br>till en PoC som hostar en React-app på jsDelivr
Thomas Frank, 2026

<br><br><br>
(Vänster/högerpil för att bläddra, tryck F för fullskärmsläge)

# Vem är Thomas?
* Examen i Informatik och Medie- och kommunikationsvetenskap (Lunds Universitet)
* Datorboksförfattare + webbmaster (Lundahls Förlag, 1997-2000)
* Utvecklare, projektledare, utvecklingschef (Studentlitteratur 2000-2013)
* IT-konsult från 2013, bl.a. arkitekt för ny webb hos Axis Communications (2016-2018)
  * På Axis arbetade Thomas även mycket med cache-uppsättning via Akamai's CDN-system.
* Lärare/föreläsare YH-nivå (utveckling, testning, säkerhet, projektledning inom IT), från 2013
* CEO för Node Hill AB, från 2017

![Thomas](images/thomas.jpg?round-right-small)

# Agenda

## Det vi ska gå igenom<br>

1. **Vad är CDN:er?** — grunden, begreppen, varför vi har dem
2. **En titt på jsDelivr** — en av de största gratis-CDN:erna
3. **Kan man hacka jsDelivr?** — en sårbarhet jag hittade (och anmälde)
4. **Andra CDN:er och molnet** — varför de är kritiska för hela internet
5. **När en stor CDN går ner** — cascading failures och verkliga incidenter<br><br>

Frågor och diskussion välkomnas löpande!


# 1. Vad är CDN:er?

## Content Delivery Network<br>

En **CDN** är ett globalt nätverk av servrar vars enda syfte är att leverera innehåll — bilder, JavaScript, CSS, video, filer — till användare **så snabbt som möjligt**.

<br>
**Grundidén:**
* En användare i Göteborg ska inte behöva hämta en bild från en server i Kalifornien — flera tusen km på glasfiber, ofta hundratals ms latency
* CDN:en håller kopior av innehållet på servrar **nära användaren**
* Svaret kommer från närmaste server — ofta inom några få millisekunder

<br>

**CDN:er föddes i slutet av 90-talet.** Akamai (grundat 1998 på MIT) var först. De löste problemet när webbsajter blev multimedia-tunga och en enda server i USA inte räckte för global publik och ger

* Kortast möljliga väg från klient till server
* Extra server-kapacitet jämfört med att bara köra på en egen server
* **Resultat** Sajten upplevs som snabbare och företagets egna servrar avlastas.


# Problemet CDN:er löser

## Ljusets hastighet är en flaskhals<br>

Internet är snabbt — men inte magiskt. Data skickas via [undervattenskablar](http://submarinecablemap.com) och fiber, och även i fiberhastighet tar det tid.

* Stockholm → Kalifornien: ~150 ms round-trip (i absolut bästa fall, ofta betydligt långsammare)
* En typisk webbsida: 50-100 requests
* Utan CDN: varje request får den där latency-en på sig
* Med CDN: första requesten är långsam, resten (cachade) kommer på några ms

<br>

Dessutom: en enda server kan inte hantera miljontals samtidiga användare. CDN:en **fördelar** lasten automatiskt över hundratals **PoPs** (datacenter där ett CDN har utrustning placerad). 

![Undervattenskablar](/images/submarine-cable-map.png?big-right-corners)


# Vad används CDN:er till?


* **Statiska assets** — bilder, JS, CSS, fonter
* **JavaScript-bibliotek** — React, Vue, Tailwind levereras ofta via publik CDN
* **Video streaming** — Netflix, YouTube, Twitch bygger på CDN-infrastruktur
* **API-acceleration** — även dynamiskt innehåll kan cachas/accelereras
* **DDoS-skydd** — CDN:er absorberar attack-trafik innan den når din server
* **TLS-terminering** — hanterar HTTPS nära användaren
* **Säkerhetslager** — WAF (Web Application Firewall), bot-management, rate limiting
* **Edge compute** — JavaScript/Wasm körs direkt på edge-noden (Cloudflare Workers, Fastly Compute@Edge)


# Arkitekturen: PoPs, edge-servrar, origin

## Tre nyckelbegrepp<br>

**PoP — Point of Presence**
* Ett geografiskt datacenter där CDN:en har servrar
* Strategiskt placerat nära stora användarbaser och internet-knutpunkter (IXP:er)
* Cloudflare: ~330 städer, Akamai: 4000+ platser, Fastly: färre men större PoPs

<br>

**Edge-servrar**
* "Edge" = nätverkets kant, där internet möter användarnas ISP:er (De faktiska servrarna inuti en PoP som kör cachningen)
* Håller kopior av filerna, kör TLS-terminering, kör WAF-regler, osv.

<br>

**Origin**
* Den ursprungliga servern som faktiskt **äger** innehållet
* CDN:en hämtar från origin vid cache-miss, sedan cachar kopian
* Din "riktiga" server ligger typiskt här — på AWS, Azure, eller i ditt eget rack


# Cache hit vs cache miss

## Så här ser ett typiskt flöde ut<br>

**Cache HIT (vanligast efter första requesten):**
```
Webbläsare → Edge-server i Stockholm → Svar direkt (några ms)
```

**Cache MISS (första gången filen begärs):**
```
Webbläsare → Edge-server i Stockholm → Origin i USA → Svar
         ↑                              ↓
         └── cachad lokalt för nästa besökare
```

<br>

Efter första missen är filen cachad på edge-servern. Nästa besökare i närheten får svaret direkt. Cache-Control och Expires-headers styr hur länge.

<br>

**Hit-ratio** är CDN:ens viktigaste mättal (**KPI** - key performance indicator). 95%+ är bra, 99%+ är drömmen.


# Hur hittar webbläsaren rätt PoP?

## Två huvudskolor — och de är fundamentalt olika<br>

När du surfar till en sajt bakom CDN, måste DNS:en peka på **närmaste** PoP. Men hur "vet" systemet vilken som är närmast?

<br>

Det är här det blir intressant — och där Akamai och Cloudflare fattade **helt olika** designbeslut.

<br>

![Anycast vs Unicast](/images/anycast-vs-unicast.png?medium-right-corners)

* **DNS-baserad routing** — den äldre skolan (Akamai)
* **Anycast BGP** — den nyare, billigare skolan (Cloudflare, Fastly)


# DNS-baserad routing — Akamai-modellen

## Det dyra men finkorniga sättet<br>

**Hur det funkar:**
1. Användare frågar efter `example.com`
2. CDN:ens auktoritativa DNS ser vem som frågar (via IP-lookup eller EDNS Client Subnet)
3. Returnerar en unik IP för närmaste PoP

<br>

**Styrkor:**
* Finkornig kontroll — DNS-svaret kan ta hänsyn till serverbelastning, nätverkskongestion, tid på dygnet
* Kan styra baserat på real-time RUM-data (Real User Monitoring)

<br>

**Svagheter & kostnad:**
* Kräver **enormt många PoPs** för att funka (Akamai: 4000+ lokationer, 200 000+ servrar i 135+ länder)
* Kräver gigantisk infrastruktur för DNS och monitoring
* Dyrt att bygga och underhålla — därför riktat till stora företag


# Anycast BGP — Cloudflare/Fastly-modellen

## Det billigare, smartare sättet<br>

**Hur det funkar:**
1. **Samma IP-adress** annonseras från alla PoPs via BGP
2. Internet-routing löser resten — trafiken går till den PoP som är närmast i **nätverkstopologi** (inte geografi)
3. Routern väljer bara kortaste hop-count, automatiskt

<br>

**Styrkor:**
* Mycket enklare att underhålla — routing-protokollet gör jobbet
* Extremt DDoS-resilient — attacken sprids automatiskt över hela nätverket
* Billigare per PoP, kan klara sig med ~300 PoPs istället för 4000

<br>

**Svagheter:**
* Mindre finkornig kontroll — kan inte lika lätt styra baserat på serverbelastning
* Kräver massor av peering-avtal och konsistent transit för att funka globalt


# Modern verklighet: hybrider

## De flesta kombinerar båda<br>

* **Cloudflare:** mestadels Anycast, men använder GeoDNS för vissa specialfall
* **Akamai:** DNS-baserad, men har börjat rulla ut Anycast för vissa tjänster
* **jsDelivr:** använder **flera** CDN-leverantörer parallellt (Cloudflare + Fastly + fler som backup)

<br>

**Ekonomin bakom valet:**
* Fortune 500-företag med enterprise-kontrakt → Akamai (dyrt, men extremt konfigurerbart)
* Startups, SMB, öppna projekt → Cloudflare/Fastly (self-service, snabb deploy, ofta gratis-tier)
* Detta skapar en tydlig marknadsuppdelning — och en koncentration av trafiken




# Olika typer av CDN:er

## Kommersiella vs publika<br>

**Kommersiella (betal-)CDN:er:**
* Cloudflare, Fastly, Akamai, AWS CloudFront, Google Cloud CDN, Azure Front Door
* För företag med egna sajter och tjänster
* Prismodeller: bandwidth, requests, regioner, features

<br>

**Publika (gratis) CDN:er för open source:**
* **jsDelivr** — npm + GitHub + WordPress-plugins
* **cdnjs** (drivs av Cloudflare) — hostar populära bibliotek
* **unpkg** — kopplad till npm, ägd av Cloudflare
* Alla kan länka in filer från ett public repo eller ett npm-paket — **utan registrering**


# 2. En titt på jsDelivr

## En av världens största gratis-CDN:er<br>

* Grundad 2012, drivs som open source / non-profit
* **Hundratals miljarder requests per månad**
* Levererar från npm, GitHub, WordPress plugins
* Används av miljontals webbsajter
* **Gratis, för alla, utan registrering**

<br>

Om du någonsin skrivit:
```html
<script src="https://cdn.jsdelivr.net/npm/..."></script>
```
...så har du använt jsDelivr.


# jsDelivrs arkitektur

## Multi-CDN under huven<br>

jsDelivr använder **flera CDN-leverantörer parallellt**:

* **Cloudflare** — dominerar i praktiken för många regioner
* **Fastly** — lika stor volym, dominerar i andra regioner
* **Bunny, GCore** — listade som sponsorer, men i praktiken används CF/Fastly nästan alltid

<br>

**Smart load-balancing** väljer leverantör i realtid baserat på:
* Latency till användaren
* Tillgänglighet senaste minuterna
* RUM-data från verkliga användare
* Om en leverantör får problem → trafiken skiftar automatiskt

<br>

Detta är elegant — jsDelivr får failover "gratis" eftersom de byggt på flera oberoende CDN:er.


# Hur levereras filerna?

## Flödet för en typisk fil<br>

```
npm/GitHub  →  jsDelivr AWS S3 (permanent storage)
                     ↓
              Multi-CDN (Cloudflare/Fastly/...)
                     ↓
              Edge-server nära användaren
                     ↓
                 Din webbläsare
```

[AWS S3](https://aws.amazon.com/s3)

<br>

**S3 som permanent lager är viktigt:** om npm eller GitHub går ner, eller ett paket tas bort, **fortsätter jsDelivr att leverera**. Alla filer är immutable per version — du kan inte smyga ut en ändrad kopia i efterhand.

<br>

Detta är samtidigt deras säkerhets-modell: `<script src="cdn.jsdelivr.net/npm/jquery@3.6.0/...">` ger dig alltid samma fil. Idag, imorgon, om fem år.


# En typisk request — vad får vi tillbaka?

## Headers från en fil levererad via jsDelivr<br>

```
HTTP/2 200
content-type: image/svg+xml
cache-control: public, max-age=31536000, immutable
access-control-allow-origin: *
access-control-expose-headers: *
cross-origin-resource-policy: cross-origin
x-content-type-options: nosniff
cf-cache-status: HIT
server: cloudflare
```


**Ett par saker att notera:**
* Öppen CORS (`*`) — designat för att vara tillgängligt från alla domäner
* Lång cache (1 år, `immutable`) — filer ändras aldrig
* `nosniff` satt — content-type respekteras strikt av webbläsaren
* Levereras från Cloudflare (i detta fallet)


# 3. Kan man hacka jsDelivr?

## Kort svar: kanske inte hacka — men missbruka<br>

Det här är en historia om:
* En saknad header
* En 25 år gammal W3C-teknologi de flesta har glömt
* En webbläsare som inte spelade med
* Och en komplett React-app som körde från en CDN där den inte borde ha kunnat köra

<br>

Låt oss börja där jag började: med headers.

<br>

### Fullständig PoC - proof of concept för mitt hack
* GitHub: https://github.com/ironboy/xml-vector
* [Ladda hem som zip](https://github.com/ironboy/xml-vector/archive/refs/heads/main.zip)
* Tänk på: I en editor som Visual Studio Code visas svg-filer som bilder, för att se som kod<br> ändra filändelsen tillfälligt till **.xml**.

# Vad som INTE fanns i headers

## Två kritiska saknade headers<br>

När jag tittade noga på response-headers för en SVG-fil levererad via jsDelivr, såg jag detta:

```
❌ Content-Security-Policy      (saknas)
❌ Frame-ancestors restriction  (saknas)
```

<br>

Allt annat var korrekt konfigurerat:
* ✅ `X-Content-Type-Options: nosniff`
* ✅ `Content-Type: image/svg+xml`
* ✅ CORS korrekt konfigurerat

<br>

Men utan CSP… vad händer om SVG:en innehåller ett script?


# Första insikten: SVG är XML, och XML kan köra script

## Ett gammalt fenomen som fortfarande fungerar<br>

SVG är inte bara en bildformat — det är **XML**. Och SVG-specen tillåter `<script>`-element inline.

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <script><![CDATA[
    alert('Hej från jsDelivr!');
  ]]></script>
</svg>
```

<br>

**Om** jag laddar upp detta till ett GitHub-repo och navigerar direkt till:
```
https://cdn.jsdelivr.net/gh/user/repo/fil.svg
```

...så **kör webbläsaren scriptet**. Koden exekveras i kontexten av `cdn.jsdelivr.net`.


Det är viktigt att vara tydlig: SVG:er som laddas via `<img src=...>` kör **inte** script. Det är bara när de renderas som en dokument-rot (navigering direkt) som det händer.


# Varför är det ett problem?

## Trust abuse på en av webbens mest betrodda domäner<br>

* **Phishing på en betrodd domän** — sajter och corporate proxies som blocklistar okända domäner släpper igenom `cdn.jsdelivr.net` utan att blinka
* **Malware-distribution** — samma domän kan leverera ondsint JavaScript
* **Trust-bypass** — säkerhetsverktyg ser "legitim CDN-trafik" i loggarna
* **Gratis hosting** för fungerande JavaScript — ingen registrering, ingen betalning, ingen spårbarhet
* **Bandwidth-abuse** — missbruk av en gratistjänst

<br>

Men SVG med ett script är bara en varning-alert. Tänk om man kan göra mer? Tänk om man kan servera en **hel sida**?


# Andra insikten: XSLT

## XML + Stylesheet = HTML<br>

**XSLT** (XSL Transformations) är en W3C-teknologi från tidigt 2000-tal. Den var tänkt att vara revolutionen för webben — strukturerad data (XML) + transformation (XSLT) = presentation (HTML).

<br>

Det blev aldrig så. Webben valde HTML direkt. Men XSLT **stöds fortfarande** i alla moderna webbläsare.

<br>

Och det betyder: en XML-fil kan referera en XSLT som transformerar den till valfri HTML. Som sedan renderas.


# Problem på vägen: Min ursprungliga XSLT krånglade i Firefox


Min första version av XSLT använde `disable-output-escaping` för att skriva ut `<!DOCTYPE html>`:

```xml
<xsl:text disable-output-escaping="yes">
  &lt;!DOCTYPE html&gt;
</xsl:text>
```

<br>

**Fungerade perfekt i Chrome och Safari. Men i Firefox** skrevs bara den escapade texten rakt ut på sidan. `<!DOCTYPE html>` som synlig text, inte som doctype.

<br>

Firefox stödjer inte `disable-output-escaping` konsekvent — det är en optional-feature i XSLT-specen, och deras implementation är begränsad.

![Firefox](/images/firefox-logo.png?small-right)


# Lösningen: `<xsl:output>`

## Den standardiserade, korrekta vägen<br>

Istället för att hacka via escape-tricks, använder man `<xsl:output>`-elementet:

```xml
<xsl:output method="html"
  doctype-system="about:legacy-compat"
  encoding="UTF-8"
  indent="yes"/>
```

<br>

* `method="html"` → transformatorn vet att output ska vara HTML
* `doctype-system="about:legacy-compat"` → genererar `<!DOCTYPE html>` på rätt sätt
* Fungerar i **alla** moderna webbläsare — Firefox, Chrome, Safari, Edge

<br>

Lärdom: standarder finns av en anledning. `disable-output-escaping` är en hack.


# PoC-filen config.xml

## Entrypointen ser oskyldig ut<br>

```xml
<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="style.xslt"?>
<oh/>
<!-- arbitrary base element - needed for xsl to render -->
```

<br>

* Filen heter `config.xml` — låter trivial, kanske en config-fil för ett bibliotek
* Refererar en XSLT-fil bredvid via `<?xml-stylesheet ...?>`
* Innehåller bara ett tomt element (krävs för att XSLT ska triggas)

<br>

Via jsDelivr: https://cdn.jsdelivr.net/gh/ironboy/xml-vector/config.xml

<br>

Användaren klickar. Webbläsaren hämtar XML. Ser xml-stylesheet-direktivet. Hämtar XSLT. Kör transformationen. Och nu är det en HTML-sida.


# style.xslt — transformation till HTML

## Här blir det intressant<br>

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

<xsl:output method="html"
  doctype-system="about:legacy-compat"
  encoding="UTF-8" indent="yes"/>

<xsl:template match="/">
  <html><head>
    <meta name="viewport" content="width=device-width"/>
    <title>React App</title>
  </head><body>
    <script src="load-script.js"></script>
  </body></html>
</xsl:template>

</xsl:stylesheet>
```

<br>

Resultatet är en fullvärdig HTML5-sida. Webbläsaren ser `<!DOCTYPE html>` och renderar den som vilken sajt som helst.


# load-script.js — bootstrapen

## En vanlig JavaScript-fil som laddar resten<br>

```javascript
// Ladda CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'assets/index-abc123.css';
document.head.append(link);

// Skapa root-div för React
const div = document.createElement('div');
div.id = 'root';
document.body.append(div);

// Ladda den minifierade React-bundeln
const script = document.createElement('script');
script.src = 'assets/index-xyz789.js';
document.body.append(script);
```

<br>

Det här är en imitation av det som en Vite-build normalt gör i `index.html` — fast vi gör det via JavaScript eftersom vi inte kan ha en riktig index.html.


# En liten justering: Vite default-exemplet funkade inte direkt

## Root-relativa paths var problemet<br>

Ett standard Vite + React-projekt använder rot-relativa paths i bildreferenser:
```html
<img src="/images/react.svg" />
```

<br>

Det fungerar inte när hela appen serveras från en path som:
```
https://cdn.jsdelivr.net/gh/user/repo/config.xml
```

Eftersom `/images/react.svg` går till `cdn.jsdelivr.net/images/react.svg` — vilket inte finns.

<br>

**Lösning:** använda relativa paths istället: ```<img src="images/react.svg" />```


# Hela kedjan — visualiserat

## Samma kedja — två möjliga ingångsfiler<br>

```
Användare går till (besöker via en jsDelivr-url):
/preview.svg  ELLER  /config.xml    (båda innehåller xml-stylesheet-direktiv)
                ↓
        Webbläsaren hämtar style.xslt
                ↓
        XSLT transformerar rot-dokumentet till HTML
                ↓
        HTML-sidan laddar load-script.js
                ↓
        load-script.js laddar CSS + React-bundle
                ↓
        React renderar — appen är live
```

<br>

**Allt hostat på `cdn.jsdelivr.net`.** Ingen registrering. Ingen betalning. Helt osynligt för jsDelivr själva.


# Vad har vi egentligen gjort?

## Vi har gjort jsDelivr till ett webbhotell<br>

* En fullständig Single Page Application
* Med React-runtime, state management, allt
* Levererad från en betrodd, globalt cachad, CDN
* **Utan att någon registrerat något**
* **Utan att någon betalat något**
* **Utan att någon visste om det**

<br>

Det jsDelivr var tänkt för: statiska assets — JS-bibliotek, CSS-filer, bilder.
Det vi gjorde: hostade en hel app.

<br>

Skillnaden mellan **användning** och **missbruk**. jsDelivrs affärsmodell (och gratis-tiers generellt) bygger på att assets levereras — inte att hela applikationer körs gratis på deras infrastruktur.


# Phishing-scenariot — varför är detta skrämmande?

## Det handlar inte bara om gratis hosting<br>

Tänk att du får följande email:

```
Subject: New lightweight XML config library - no dependencies!

Check out this elegant approach to config management:
https://cdn.jsdelivr.net/gh/elegant-tools/config/demo.xml

Zero runtime overhead, just pure data!
```

<br>

Eller:

```
Subject: Free SVG icon pack - 500+ icons

Beautiful open-source icons for your next project:
https://cdn.jsdelivr.net/gh/icon-pack/preview.svg
```

<br>

Utvecklaren klickar. URL:en är **whitelistad** av corporate proxy. Sidan ser ut som en GitHub-login. Credentials stjäls. Ingen varnas.


# Konkret phishing-exempel 1: SVG-preview

## Ett riktat mejl med riktig URL<br>


From: John Patel <john@cloud-experts.io><br>
To: [developer]@[target-company].com<br>
Subject: How we made our main site 3× faster — preview inside<br><br>

Hi,

Saw you're working on [Company]'s frontend performance — we
recently rolled out a cloud-based setup that cut our Largest
Contentful Paint from 2.8s to 0.9s. Same tech stack as yours.

Here's a live preview of the architecture diagram, hosted on
jsDelivr so it loads anywhere:

https://cdn.jsdelivr.net/gh/ironboy/xml-vector/preview.svg

Happy to jump on a 20-min call if you want to hear the details.
<br><br>
Kind regards<br>
John Patel<br>
Senior Platform Engineer, Cloud Experts



# Konkret phishing-exempel 2: XML-config

## En variant som träffar konfig-folk<br>

From: Anna Lindqvist <anna@config-experts.net><br>
To: [devops]@[target-company].com<br>
Subject: Re: optimal config for Vercel-stack — example file attached
<br><br>
Hi,

Following up on the thread from last week's Slack community
about tuning Vercel. As promised, here's the XML config we
landed on after six months of production use. It handles
~40k RPS with sub-10ms p99 on modest hardware.

The file is self-documenting — just open it in the browser
to see the structure and inline comments:

https://cdn.jsdelivr.net/gh/ironboy/xml-vector/config.xml

Let me know if you want me to walk through the trickier
parts (sharding policy, circuit breaker thresholds).

Don't hesistate to contact us!<br><br>

Anna Lindstrom<br>Principal Engineer, Config Experts



# Varför dessa fungerar

## Social engineering + teknisk trovärdighet<br>

* **Specifika siffror** — "2.8s till 0.9s", "40k RPS", "sub-10ms p99" — låter som riktig ingenjörskonversation
* **Referens till tidigare kontext** — "saw you're working on…", "following up on the thread" — skapar illusion av etablerad relation
* **Rimlig avsändare** — yrkesroller och företagsnamn som inte går att verifiera på 10 sekunder
* **URL:en ser ofarlig ut** — det är ju bara en preview/en config-fil, inte en inloggningssida
* **jsDelivr-domänen** — om någon hoverar över länken så är det en CDN de litar på

<br>

När målet klickar kör antingen SVG:ens inline-script, eller XSLT-kedjan som laddar en full fejk-login-sida. Ingen warning. Inget nytt certifikat. Inga blockeringar.


# Responsible disclosure

## Vad man ska göra när man hittar en sårbarhet<br>

**Steg 1: Verifiera i egen kontrollerad miljö**
* Bygg PoC:en lokalt först (Node/Express på localhost)
* Verifiera att attacken fungerar innan du testar i produktion

**Steg 2: Testa minimalt på målet**
* Bara det som behövs för att bevisa att det är ett riktigt problem
* Ingen skada på andra användare, ingen spridning

**Steg 3: Anmäl direkt till leverantören**
* Kolla efter security.txt, bug bounty-program, dedikerad kontakt
* Ge dem rimlig tid att patcha (30-90 dagar är standard)

**Steg 4: Håll detaljer privata tills fix släppts**
* Publik PoC-kod är okej — men förstås inte testa social engineering / phishing-scenarier före patch.

# SVG-hack (skärmbild)
Nu har anmält sårbarheten till **jsDelivr** och därmed hoppas vi att den stängs ner. Det innebär att den kod och de länkar jag har i denna presentation kring PoC för sårbarheten i så fall slutar fungera. Som en dokumentation för framtiden har jag därför en skärmbild av hacket i "SVG-version":

![SVG-hack](/images/svg-hack.png?full-width)

# XML-hack (skärmbild)
Nu har anmält sårbarheten till **jsDelivr** och därmed hoppas vi att den stängs ner. Det innebär att den kod och de länkar jag har i denna presentation kring PoC för sårbarheten i så fall slutar fungera. Som en dokumentation för framtiden har jag därför en skärmbild av hacket i "XML-version":

![XML-hack](/images/xml-hack.png?full-width)



# Vad jsDelivr borde göra!

## Tekniska mitigations<br>

**Adding the missing headers:**
```
Content-Security-Policy: default-src 'none'; sandbox
X-Frame-Options: DENY
```

<br>

**Mer restriktiv serving:**
* Sätt `Content-Disposition: attachment` för XML/SVG som inte är kända asset-typer
* Whitelist content-types som får renderas inline
* Rate-limiting på ovanliga filmönster per repo/user

<br>

**Detection:**
* Scanning av repos för suspicious patterns (XSLT-referenser, script i SVG)
* Warning-sidor för ovanliga filmönster

<br>

Många av dessa är billiga att implementera. CSP-headern kostar en rad i nginx-konfigen. Mitigationen för hela attack-klassen är inte stor.


# Läxor från denna sårbarhet

## Vad kan vi ta med oss?<br>

* **Headers är viktiga.** Även "oviktiga" headers som CSP kan vara skillnaden mellan säker och osäker leverans.
* **Content-Type räcker inte.** Webbläsare gör saker med filer baserat på mer än bara Content-Type.
* **Gamla teknologier dör inte.** XSLT är från 2001. Det stöds fortfarande. Någon kan använda det.
* **Öppenhet är en attack-vektor.** CDN:er är designade för att vara öppna — men öppenhet utan begränsningar är risk.
* **Trust by association.** Folk litar på domänen, inte på innehållet.
* **Browser-inkompatibilitet är ingen säkerhetsbarriär.** Firefox vägrade min första XSLT — men det gick att kringgå.


# 4. Andra CDN:er och molnet

## CDN:er är ryggraden i internet<br>

**Stora spelare:**
* **Cloudflare** — ~20% av alla websites, Anycast-pionjär
* **Fastly** — snabba edge-beräkningar, used by GitHub, Shopify, Reddit, HN
* **Akamai** — äldst, störst infrastruktur, enterprise-fokus
* **AWS CloudFront** — djup AWS-integration, bra för AWS-workloads
* **Google Cloud CDN, Azure Front Door** — motsvarande för respektive moln

<br>

**Den nya generationen:**
* **Vercel, Netlify** — frontend-hosting byggt ovanpå Cloudflare/Fastly/AWS
* **Bunny.net** — low-cost challenger, växer snabbt
* Specialiserade video-CDN:er, bild-CDN:er, osv.


# Mer än bara cachning

## Modern CDN = säkerhet + edge-compute + routing<br>

Dagens CDN:er gör massor:

* **DDoS-skydd** — absorberar Tbps-attacker över hela anycast-nätet
* **WAF** — blockerar kända attack-mönster (SQLi, XSS, CSRF)
* **Bot-management** — filtrerar bort scraping, credential stuffing
* **Edge workers** — JS/Wasm körs på edge-noden, inte på origin
* **Smart DNS** — Anycast-routing, geo-blocking, failover
* **TLS-terminering + HTTP/3 + QUIC**
* **Image optimization** — auto-resize, format-konvertering (AVIF/WebP) i farten
* **Logging & analytics** — gigantiska mängder trafikdata realtids-aggregerade


# CDN:er som en del av molnet

## Gränsen mellan CDN och moln har suddats ut<br>

* **Cloudflare Workers** → edge-compute, ingen egen server behövs
* **Fastly Compute@Edge** → samma koncept, WebAssembly-baserad
* **AWS CloudFront + Lambda@Edge** → AWS-version
* **Vercel Edge Functions, Netlify Edge Functions** → ovanpå ovan

<br>

För många moderna webbapps är CDN:en inte bara ett lager framför backenden. Det **är** backenden. Stora delar av Vercel-hostade sajter kör all logik på Cloudflares edge.

<br>

Detta är en **massiv förändring** på fem år. 2019 var en CDN en cache. 2026 är en CDN en komplett applikationsplattform.


# Varför är CDN:er kritiska för hela internet?

## Tre anledningar<br>

**1. Skala.** Utan CDN skulle varje request gå till origin. Internet som vi känner det — streaming, sociala medier, SaaS-appar — vore tekniskt omöjligt. Netflix + YouTube ensamma genererar ~25% av internettrafiken. De kan inte funka utan CDN.

<br>

**2. Säkerhet.** DDoS-skyddet är i praktiken bara möjligt med global närvaro. En ensam server kan inte motstå en 1 Tbps-attack. Men ett nätverk med 300 PoPs som var och en ser ~3 Gbps? Hanterbart.

<br>

**3. Centralisering.** Paradoxalt: för att möjliggöra den **distribuerade** webben har vi **koncentrerat** trafiken till ett fåtal aktörer. Cloudflare ensamt sitter framför kanske 20% av webben.


# Hur central är centraliseringen?

## Några siffror att smälta<br>

* **Cloudflare** hanterar DNS och/eller CDN för ~20% av alla websites globalt
* **Top 3 cloud providers** (AWS, Azure, GCP) hostar en majoritet av webbtjänsterna
* **jsDelivr + cdnjs + unpkg** levererar JS-bibliotek till miljoner sajter
* En enskild CDN-outage kan ta ned **tiotusentals sajter samtidigt**

<br>

Och det har hänt. Flera gånger. Nästa sektion visar hur det kan se ut.

![Centralisering](/images/cables.avif?medium-right-corners)


# 5. Vad händer när en stor CDN går ner?

## Stora delar av internet slutar fungera<br>

Och inte bara "några sajter".

<br>

* Myndighetstjänster
* Banker och betaltjänster
* Streaming-plattformar
* Matleverans-appar
* Social media
* API:er som andra tjänster är beroende av
* Ibland även **DNS**-servrar — vilket även påverkar sajter som inte ens är direkta CDN-kunder

<br>

Det här är den **systemiska risken** med koncentrerad infrastruktur.


# Fastly-outaget, juni 2021

## En enda bugg tog ner halva internet<br>

**Vad hände:**
* En kund pushade en till synes harmlös konfig-ändring
* Triggade en latent bugg i Fastlys software som hade funnits månader
* **Hela det globala nätverket** gick ner i ~1 timme

<br>

Recovery började efter ~49 minuter. Full återhämtning tog flera timmar.


# Fastly-outaget — vad gick offline?

## Listan är skrämmande<br>

* **Reddit, Twitch, Shopify, GitHub, Stack Overflow**
* **New York Times, BBC, Guardian, CNN, Financial Times, Bloomberg**
* **Amazon, PayPal, Spotify**
* **UK Government-sajter** — gov.uk gick ner helt
* **IMDB, Hulu, Vimeo**

<br>

Under ~1 timme den 8 juni 2021 var en massiv del av webben **helt oåtkomlig**. Från konfig-push till global outage: några minuter. Detta trots Fastlys rykte som en av de mest driftsäkra CDN:erna i världen.


# Cloudflare-incidenter

## Flera stora, i olika former<br>

**Juli 2019** — BGP-läckage från en kund i Pennsylvania, som Verizon förmedlade. Routade stora delar av Cloudflare-trafik fel i 90 minuter. Discord, Feedly, Crunchyroll nere.

<br>

**Juni 2022** — routing-bugg efter nätverksuppgradering. 19 datacenter offline samtidigt. Discord, Shopify, Fitbit nere i timmar.

<br>

**November 2023** — kontrollplanet nere, Workers KV otillgänglig, Zero Trust-tjänster bröts i ~2 dagar (vissa delar).

<br>

Varje gång: **tiotusentals sajter** samtidigt ned. Varje gång: orsak var något internt hos Cloudflare — inte en attack utifrån.


# AWS us-east-1, december 2021

## Inte direkt ett CDN-outage, men illustrativt<br>

us-east-1 är AWS äldsta, största region — och den mest problematiska.

* En automatiserad process skalade upp nätverkskapacitet
* Triggade överbelastning av interna API:er
* Cascading failure genom hela regionen

<br>

**Tjänster som drog med sig andra:**
* Disney+, Netflix-delar, Amazon själva
* **Ring-kameror, Roomba, smart home** — hemma hos folk slutade dörrklockor fungera
* Stora delar av AWS som **andra moln och CDN:er** bygger på

<br>

Varade 5-7 timmar för huvudtjänsterna. Men för beroende tjänster tog det över ett dygn att återhämta sig helt.


# Varför "går internet ner"?

## Cascading failures — dominoeffekter<br>

Modern webb är ett nät av beroenden:

```
Din sajt → CDN → Auth-tjänst → Analytics
       → npm-paket från CDN
       → Externa API:er som också använder CDN
       → DNS hostat hos CDN:en
```

När CDN:en går ner:
* Din HTML serveras kanske fortfarande (från egen server)
* Men JavaScript laddas inte → appen startar inte
* Auth-flödet bryts → ingen kan logga in
* Analytics-script hänger → sidan upplevs trasig även om backend funkar

<br>

Resultat: även om **din** server är uppe, ser användaren en knäckt sajt. Vissa tjänster är så djupt beroende av externa CDN:er att de inte har någon fallback alls.


# Ett lokalt exempel

## Vad händer om jsDelivr går ner?<br>

* Miljontals sajter som använder `<script src="cdn.jsdelivr.net/...">` slutar ladda scripts
* Många är personliga sajter, blogg-templates, småföretag
* Appar som laddar charts, PDF-genererare, översättningar via CDN — trasiga
* **Ingen av dem vet om det direkt** — sajten ser bara mystiskt knäckt ut

<br>

Dessutom — när jsDelivr växlar mellan Cloudflare och Fastly beroende på tillgänglighet, innebär det att **jsDelivr själva är skyddade mot en enskild leverantörs outage**. Men användare av jsDelivr är det inte nödvändigtvis — om deras *andra* CDN-beroenden också går ner samtidigt.

<br>

Lärdom: **din upptime är aldrig högre än upptime på din svagaste externa beroende**.


# Hur skyddar man sig?

## Konkreta tekniker<br>

* **Subresource Integrity (SRI)** — hash-baserad verifikation av CDN-filer, skyddar mot tampering
* **Self-hosting av kritiska assets** — speciellt för produktion
* **Multi-CDN-strategi** — failover mellan leverantörer (det jsDelivr själva gör)
* **Gracefully degradering** — sajten ska funka även om CDN:en är död
* **Status monitoring** — följ status.cloudflare.com, status.fastly.com osv. för realtids-updates
* **CSP** - Content Security Policy-header - se nästa slide

<br>

**SRI är gratis och enkelt:**
```html
<script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"
  integrity="sha384-..."
  crossorigin="anonymous"></script>
```

Om filen ändrats — även en enda byte — matchar inte hashen, och webbläsaren vägrar köra scriptet.

# CSP — Content Security Policy, slide 1/2

## Din starkaste header mot CDN-missbruk<br>

**CSP** är en HTTP-header som berättar för webbläsaren **varifrån** resurser får laddas och **vilken typ** de får vara. Allt annat blockeras — även om det redan står i din HTML.

<br>

**Exempel: begränsa till betrodda CDN:er och specifika filtyper**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net;
  style-src 'self' https://fonts.googleapis.com;
  img-src 'self' data: https://cdn.jsdelivr.net;
  font-src 'self' https://fonts.gstatic.com;
  object-src 'none';
  frame-ancestors 'none';
```

# CSP — Content Security Policy, slide 2/2

* **`script-src`** — vilka domäner får leverera JavaScript? `'self'` + utvalda CDN:er
* **`style-src`, `img-src`, `font-src`** — samma princip per resurstyp
* **`object-src 'none'`** — blockerar `<embed>`, `<object>`, plugins
* **`frame-ancestors 'none'`** — din sida får inte bäddas in i iframe (clickjacking-skydd)

<br>

CSP flyttar förtroendet från "domänen" till **din egen whitelist**. Notera dock: detta skyddar *dina besökare på din sajt* — inte någon som följer en `cdn.jsdelivr.net`-länk direkt från ett mejl. Det är därför **båda** nivåerna behövs: CSP hos jsDelivr (vilket de saknar) *och* CSP hos dig.

<br>

Läs mer: [MDN: Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)


# Sammanfattning

## Vad vi gick igenom<br>

* **CDN:er** är distribuerade nätverk som levererar innehåll snabbt och säkert — via PoPs och edge-servrar
* **Routing-modeller** skiljer sig: Akamais dyra DNS-baserade vs Cloudflares billigare Anycast BGP
* **jsDelivr** är en av de största gratis-CDN:erna — multi-CDN under huven
* **Säkerhetshål uppstår** även i betrodda tjänster — saknade headers + XSLT från 2001 = full React-app-hosting
* **CDN:er är kritiska** för hur internet faktiskt fungerar idag
* **När de går ner** går stora delar av webben med — och lösningen är medveten design och multi-CDN

<br>

**Kärninsikten:** Centralisering ger oss hastighet och säkerhet — men också gemensam sårbarhet.


# Cachning är smärtsamt, slide 1/2

## "There are only two hard things in Computer Science:<br>cache invalidation and naming things." — Phil Karlton<br>
<br>

**På Axis, med Akamai (2016-2018):** stora delar av min tid gick åt att finjustera cachningsregler. Hur länge ska JS cachas? CSS? Bilder? Fonter? HTML-skalet? Vad händer när vi pushar en kritisk fix — hur snabbt når den alla edge-servrar? Varje filtyp krävde sitt eget tänk, och invalidation var ständigt en källa till buggar.

<br>

**Dagens enklare approach — "content-hashade bundles":**

* Varje deploy genererar filer med unika namn baserade på version eller git-hash:<br>`index-a7f3c9.js`, `index-a7f3c9.css`
* Filerna cachas **för alltid** (`max-age=31536000, immutable`) — de ändras ju aldrig
* Ett enda litet **ocachat** skript (eller HTML-fil) pekar ut vilken version som är aktuell
* Nästa deploy = nya filnamn = webbläsaren hämtar nytt utan invalidation-trassel

# Cachning är smärtsamt, slide 2/2

**Dagens enklare approach — "content-hashade bundles":**

* Varje deploy genererar filer med unika namn baserade på version eller git-hash:<br>`index-a7f3c9.js`, `index-a7f3c9.css`
* Filerna cachas **för alltid** (`max-age=31536000, immutable`) — de ändras ju aldrig
* Ett enda litet **ocachat** skript (eller HTML-fil) pekar ut vilken version som är aktuell
* Nästa deploy = nya filnamn = webbläsaren hämtar nytt utan invalidation-trassel

<br><br>

**Varför gjorde vi inte detta på Axis?** 

<br>

En stor sajt med hundratusentals dagliga besökare och flera deploys per dag får varje gång en våg av cache-missar mot nya filnamn. För mindre sajter är kostnaden försumbar, men för enterprise-trafik kan det bli märkbart i origin-belastning och edge-overhead. Content-hashing är **enkelt** (kan byggas in som build-step vid deploy med några få rader scriptning) — *men inte gratis för en stor sajt med frekventa uppdateringar*.

# Tack för att ni lyssnade!

<br>

**Thomas Frank**
* Email: thomas@nodehill.se
* LinkedIn: [linkedin.com/in/thomas-frank-7514a78](https://linkedin.com/in/thomas-frank-7514a78)
* Företag: [Node Hill AB](https://nodehill.com)

<br>

**Resurser:**
* [jsDelivr Network Status](https://www.jsdelivr.com/network)
* [Subresource Integrity (MDN)](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
* [Cloudflare post-mortems](https://blog.cloudflare.com/tag/outage/)
* [Fastly June 2021 outage summary](https://www.fastly.com/blog/summary-of-june-8-outage)
* [Anycast vs DNS routing explained](https://www.cloudflare.com/learning/cdn/glossary/anycast-network/)

