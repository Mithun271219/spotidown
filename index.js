require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const axios = require("axios")

const playlistUrl = process.env.PLAY_LIST_URL;
const spotifyUrl = "https://open.spotify.com";
const postMethod = "https://spotdown.org/api/download";
let playListDynamicFolderName = ""

const extractSongsName = async () => {

    const browser = await puppeteer.launch({
        headless: true,
        executablePath:
            "C:\\Users\\Ashwini\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        defaultViewport: null,
    });

    const page = await browser.newPage();

    await page.goto(playlistUrl, {
        waitUntil: "networkidle2",
        timeout: 60000,
    });

    await page.evaluate(() => (document.body.style.zoom = "50%"));

    // ─────────────────────────────────────────────
    // Playlist Name
    // ─────────────────────────────────────────────
    const playListNameClass = ".BOjeWsq7rAtXYUaR86bq";
    await page.waitForSelector(playListNameClass, { timeout: 50000 });

    const playListName = (
        await page.$eval(playListNameClass, el => el.textContent)
    ).split(".")[0];

    playListDynamicFolderName = playListName

    console.log("Playlist:", playListName);

    const songsCountXPath = "/html/body/div[4]/div/div[2]/div[6]/div/div[2]/div[1]/div/main/section/div[1]/div[2]/div[3]/div[2]/div/span[1]"
    await page.waitForSelector(`xpath=${songsCountXPath}`, { timeout: 50000 })
    const songsCounterEle = await page.$(`xpath=${songsCountXPath}`)
    const songsCountText = await page.evaluate(songsCounterEle => songsCounterEle.textContent.trim(), songsCounterEle);
    const songsCount = songsCountText.split(" ")[0]

    console.log("playList count : ", +(songsCount));

    const playListFolder = path.resolve(__dirname, playListName);
    fs.mkdirSync(playListFolder, { recursive: true });

    const outputFile = path.join(playListFolder, `${playListName}.json`);

    // ─────────────────────────────────────────────
    // Songs container XPath (BASE)
    // ─────────────────────────────────────────────
    const songsListXpath =
        "/html/body/div[4]/div/div[2]/div[6]/div/div[2]/div[1]/div/main/section/div[2]/div[3]/div/div[1]/div/div[2]/div[2]";

    await page.waitForSelector(`xpath=${songsListXpath}`, { timeout: 60000 });

    // ─────────────────────────────────────────────
    // SCROLL UNTIL ALL SONGS ARE LOADED
    // ─────────────────────────────────────────────
    console.log("Scrolling playlist...");

    let previousCount = 0;

    while (true) {
        const currentCount = await page.evaluate((xpath) => {
            const baseNode = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            return baseNode ? baseNode.children.length : 0;
        }, songsListXpath);

        if (currentCount === previousCount) {
            break; // no new songs loaded
        }

        previousCount = currentCount;

        await page.evaluate((xpath) => {
            const baseNode = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (baseNode) {
                baseNode.scrollTop = baseNode.scrollHeight;
            }
        }, songsListXpath);

        await new Promise(resolve => setTimeout(resolve, 1200));
    }

    console.log("Scrolling finished.");

    // ─────────────────────────────────────────────
    // EXTRACT SONGS (XPath only)
    // ─────────────────────────────────────────────
    const songs = await page.evaluate(
        (songsListXpath, spotifyUrl) => {
            const baseNode = document.evaluate(
                songsListXpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            if (!baseNode) return [];

            const rows = document.evaluate(
                "./div",
                baseNode,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
            );

            const results = [];

            for (let i = 0; i < rows.snapshotLength; i++) {
                const row = rows.snapshotItem(i);

                const nameNode = document.evaluate(
                    ".//a/div",
                    row,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;

                const linkNode = document.evaluate(
                    ".//a",
                    row,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;

                if (nameNode && linkNode) {
                    results.push({
                        name: nameNode.textContent.trim(),
                        href: spotifyUrl + linkNode.getAttribute("href"),
                    });
                }
            }

            return results;
        },
        songsListXpath,
        spotifyUrl
    );

    // ─────────────────────────────────────────────
    // DEDUPLICATE (IMPORTANT)
    // ─────────────────────────────────────────────
    const unique = {};
    songs.forEach(song => {
        unique[song.href] = song;
    });

    const finalSongs = Object.values(unique);

    fs.writeFileSync(
        outputFile,
        JSON.stringify(finalSongs, null, 2),
        "utf-8"
    );

    console.log("Total songs extracted:", finalSongs.length);
    console.log("Saved to:", outputFile);

    await browser.close();
};

const downloadSong = async (song) => {

    const safeFileName = song.name.replace(/[\/\\:*?"<>|]/g, "_");
    const fileName = path.join(`${playListDynamicFolderName}/${playListDynamicFolderName}`, `${safeFileName}.mp3`)

    payload = {
        "url": song?.href
    }

    try {
        let response = await axios.post(postMethod, payload, { responseType: "arraybuffer" })
        fs.writeFileSync(fileName, response?.data)
        return song
    } catch (error) {
        throw { song, message: error?.message ?? "some error" }
    }
}

(async () => {
    await extractSongsName();

    const songs = require(`./${playListDynamicFolderName}/${playListDynamicFolderName}.json`);

    fs.mkdirSync(`${playListDynamicFolderName}/${playListDynamicFolderName}`, { recursive: true })
    const errorFilePath = path.join(playListDynamicFolderName, "errorSongs.json");

    const songsPromise = songs.map(ele => downloadSong(ele))
    let result = await Promise.allSettled(songsPromise)

    const errorSongs = result?.filter(ele => ele?.status == "rejected")
    if (errorSongs?.length > 0) {
        fs.writeFileSync(errorFilePath, JSON.stringify(errorSongs), "utf-8")
    }

})()
