import * as blitsy from 'blitsy';
import { secondsToTime, fakedownToTag, eventToElementPixel, withPixels } from './utility';
import { sleep } from '../common/utility';
import { ChatPanel } from './chat';

import ZoneClient from '../common/client';
import { YoutubeVideo } from '../server/youtube';
import { ZoneSceneRenderer, avatarImage, tilemapContext, blockTexture } from './scene';
import { Player } from './player';
import { UserState } from '../common/zone';
import { HTMLUI } from './html-ui';
import { createContext2D } from 'blitsy';

window.addEventListener('load', () => load());

export const client = new ZoneClient();
export const htmlui = new HTMLUI();

const avatarTiles = new Map<string | undefined, CanvasRenderingContext2D>();
avatarTiles.set(undefined, avatarImage);

function decodeBase64(data: string) {
    const texture: blitsy.TextureData = {
        _type: 'texture',
        format: 'M1',
        width: 8,
        height: 8,
        data,
    };
    return blitsy.decodeTexture(texture);
}

function getTile(base64: string | undefined): CanvasRenderingContext2D {
    if (!base64) return avatarImage;
    let tile = avatarTiles.get(base64);
    if (!tile) {
        try {
            tile = decodeBase64(base64);
            avatarTiles.set(base64, tile);
        } catch (e) {
            console.log('fucked up avatar', base64);
        }
    }
    return tile || avatarImage;
}

function notify(title: string, body: string, tag: string) {
    if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
        const notification = new Notification(title, { body, tag, renotify: true, icon: './avatar.png' });
    }
}

const font = blitsy.decodeFont(blitsy.fonts['ascii-small']);
const layout = { font, lineWidth: 240, lineCount: 9999 };

function parseFakedown(text: string) {
    text = fakedownToTag(text, '##', 'shk');
    text = fakedownToTag(text, '~~', 'wvy');
    text = fakedownToTag(text, '==', 'rbw');
    return text;
}

const chat = new ChatPanel();

function getLocalUser() {
    return client.localUserId ? client.zone.getUser(client.localUserId) : undefined;
}

let localName = localStorage.getItem('name') || '';

function rename(name: string) {
    localStorage.setItem('name', name);
    localName = name;
    client.rename(name);
}

function socket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const secure = window.location.protocol.startsWith('https');
        const protocol = secure ? 'wss://' : 'ws://';
        const socket = new WebSocket(protocol + zoneURL);
        socket.addEventListener('open', () => resolve(socket));
        socket.addEventListener('error', reject);
    });
}

let joinPassword: string | undefined;

async function connect(): Promise<void> {
    const joined = !!client.localUserId;

    try {
        client.messaging.setSocket(await socket());
    } catch (e) {
        return connect();
    }

    try {
        await client.join({ name: localName, password: joinPassword });
        const data = localStorage.getItem('avatar');
        if (data) client.avatar(data);
    } catch (e) {
        chat.status(e.text);
        return;
    }

    chat.log('{clr=#00FF00}*** connected ***');
    if (!joined) listHelp();
    listUsers();
}

function listUsers() {
    const named = Array.from(client.zone.users.values()).filter((user) => !!user.name);

    if (named.length === 0) {
        chat.status('no other users');
    } else {
        const names = named.map((user) => user.name);
        const line = names.join('{clr=#FF00FF}, {clr=#FF0000}');
        chat.status(`${names.length} users: {clr=#FF0000}${line}`);
    }
}

const help = [
    'use the buttons on the top left to queue videos, and the buttons on the bottom right to change your appearance. press tab to switch between typing and moving',
].join('\n');

function listHelp() {
    chat.log('{clr=#FFFF00}' + help);
}

function textToYoutubeVideoId(text: string) {
    text = text.trim();
    if (text.length === 11) return text;
    return new URL(text).searchParams.get('v');
}

export async function load() {
    htmlui.addElementsInRoot(document.body);
    htmlui.hideAllWindows();

    const popoutPanel = document.getElementById('popout-panel') as HTMLElement;
    const video = document.createElement('video');
    popoutPanel.appendChild(video);
    document.getElementById('popout-button')?.addEventListener('click', () => (popoutPanel.hidden = false));

    const player = new Player(video);
    const zoneLogo = document.createElement('img');
    zoneLogo.src = 'zone-logo.png';

    const joinName = document.querySelector('#join-name') as HTMLInputElement;
    const chatInput = document.querySelector('#chat-input') as HTMLInputElement;

    function setVolume(volume: number) {
        player.volume = volume / 100;
        localStorage.setItem('volume', volume.toString());
    }

    setVolume(parseInt(localStorage.getItem('volume') || '100', 10));

    joinName.value = localName;

    const menuPanel = document.getElementById('menu-panel')!;
    const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;

    const authRow = document.getElementById('auth-row')!;
    const authContent = document.getElementById('auth-content')!;

    volumeSlider.addEventListener('input', () => (player.volume = parseFloat(volumeSlider.value)));
    document.getElementById('menu-button')?.addEventListener('click', openMenu);

    function openMenu() {
        menuPanel.hidden = false;
        volumeSlider.value = player.volume.toString();
    }

    document.getElementById('enable-notifications')?.addEventListener('click', async () => {
        const permission = await Notification.requestPermission();
        chat.status(`notifications ${permission}`);
    });

    const userPanel = document.getElementById('user-panel')!;
    const userItemContainer = document.getElementById('user-items')!;
    const userSelect = document.getElementById('user-select') as HTMLSelectElement;

    function formatName(user: UserState) {
        if (user.tags.includes('admin')) {
            return `<span class="user-admin">${user.name}</span>`;
        } else if (user.tags.includes('dj')) {
            return `<span class="user-dj">${user.name}</span>`;
        } else {
            return user.name || '';
        }
    }

    function refreshUsers() {
        const users = Array.from(client.zone.users.values()).filter((user) => !!user.name);
        const names = users.map((user) => formatName(user));
        userItemContainer.innerHTML = `${names.length} people are zoning: ` + names.join(', ');

        userSelect.innerHTML = '';
        users.forEach((user) => {
            const option = document.createElement('option');
            option.value = user.name || '';
            option.innerHTML = formatName(user);
            userSelect.appendChild(option);
        });
        userSelect.value = '';

        const auth = !!getLocalUser()?.tags.includes('admin');
        authRow.hidden = auth;
        authContent.hidden = !auth;
    }

    document.getElementById('users-button')!.addEventListener('click', () => {
        userPanel.hidden = false;
        refreshUsers();
    });

    document.getElementById('ban-ip-button')!.addEventListener('click', () => {
        client.command('ban', [userSelect.value]);
    });
    document.getElementById('add-dj-button')!.addEventListener('click', () => {
        client.command('dj-add', [userSelect.value]);
    });
    document.getElementById('del-dj-button')!.addEventListener('click', () => {
        client.command('dj-del', [userSelect.value]);
    });
    document.getElementById('event-mode-on')!.addEventListener('click', () => client.command('mode', ['event']));
    document.getElementById('event-mode-off')!.addEventListener('click', () => client.command('mode', ['']));

    const queuePanel = document.getElementById('queue-panel')!;
    const queueItemContainer = document.getElementById('queue-items')!;
    const queueItemTemplate = document.getElementById('queue-item-template')!;
    queueItemTemplate.parentElement!.removeChild(queueItemTemplate);

    const queueTitle = document.getElementById('queue-title')!;
    const currentItemContainer = document.getElementById('current-item')!;
    const currentItemTitle = document.getElementById('current-item-title')!;
    const currentItemTime = document.getElementById('current-item-time')!;

    function refreshCurrentItem() {
        const count = client.zone.queue.length + (player.hasItem ? 1 : 0);
        let total = player.remaining / 1000;
        client.zone.queue.forEach((item) => (total += item.media.duration / 1000));
        queueTitle.innerText = `playlist (${count} items, ${secondsToTime(total)})`;

        skipButton.disabled = false; // TODO: know when it's event mode
        currentItemContainer.hidden = !player.hasItem;
        currentItemTitle.innerHTML = player.playingItem?.media.title || '';
        currentItemTime.innerHTML = secondsToTime(player.remaining / 1000);

        if (client.zone.lastPlayedItem?.info.userId) {
            const user = client.zone.getUser(client.zone.lastPlayedItem.info.userId);
            currentItemTitle.setAttribute('title', 'queued by ' + user.name);
        }
    }

    const queueElements: HTMLElement[] = [];

    function refreshQueue() {
        queueElements.forEach((item) => item.parentElement!.removeChild(item));
        queueElements.length = 0;

        const user = getLocalUser();
        client.zone.queue.forEach((item) => {
            const element = queueItemTemplate.cloneNode(true) as HTMLElement;
            const titleElement = element.querySelector('.queue-item-title')!;
            const timeElement = element.querySelector('.queue-item-time')!;
            const cancelButton = element.querySelector('.queue-item-cancel') as HTMLButtonElement;

            const cancellable = item.info.userId === user?.userId || user?.tags.includes('dj');
            titleElement.innerHTML = item.media.title;
            if (item.info.userId) {
                const user = client.zone.getUser(item.info.userId);
                titleElement.setAttribute('title', 'queued by ' + user.name);
            }
            timeElement.innerHTML = secondsToTime(item.media.duration / 1000);
            cancelButton.disabled = !cancellable;
            cancelButton.addEventListener('click', () => client.unqueue(item));

            queueItemContainer.appendChild(element);
            queueElements.push(element);
        });

        refreshCurrentItem();
    }

    document.getElementById('queue-button')!.addEventListener('click', () => {
        refreshQueue();
        queuePanel.hidden = false;
    });

    document.getElementById('auth-button')!.addEventListener('click', () => {
        const input = document.getElementById('auth-input') as HTMLInputElement;
        client.auth(input.value);
    });

    const searchPanel = document.getElementById('search-panel')!;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchSubmit = document.getElementById('search-submit') as HTMLButtonElement;
    const searchResults = document.getElementById('search-results')!;

    searchInput.addEventListener('input', () => (searchSubmit.disabled = searchInput.value.length === 0));

    document.getElementById('search-button')?.addEventListener('click', () => {
        searchInput.value = '';
        searchPanel.hidden = false;
        searchInput.focus();
        searchResults.innerHTML = '';
    });

    const searchResultTemplate = document.getElementById('search-result-template')!;
    searchResultTemplate.parentElement?.removeChild(searchResultTemplate);

    document.getElementById('search-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopPropagation();

        searchResults.innerText = 'searching...';
        client.search(searchInput.value).then((results) => {
            searchResults.innerHTML = '';
            results.forEach(({ title, duration, videoId, thumbnail }) => {
                const row = searchResultTemplate.cloneNode(true) as HTMLElement;
                row.addEventListener('click', () => {
                    searchPanel.hidden = true;
                    client.youtube(videoId);
                });

                const div = row.querySelector('div')!;
                const img = row.querySelector('img')!;

                div.innerHTML = `${title} (${secondsToTime(duration / 1000)})`;
                img.src = thumbnail || '';
                searchResults.appendChild(row);
            });
        });
    });

    client.on('disconnect', async ({ clean }) => {
        if (clean) return;
        await sleep(100);
        await connect();
    });

    client.on('joined', refreshUsers);
    client.on('join', refreshUsers);
    client.on('leave', refreshUsers);
    client.on('rename', refreshUsers);
    client.on('tags', refreshUsers);
    refreshUsers();

    client.on('queue', ({ item }) => {
        const { title, duration } = item.media;
        const user = item.info.userId ? client.zone.users.get(item.info.userId) : undefined;
        const username = user?.name || 'server';
        const time = secondsToTime(duration / 1000);
        if (item.info.banger) {
            chat.log(`{clr=#00FFFF}+ ${title} (${time}) rolled from {clr=#FF00FF}bangers{clr=#00FFFF} by {clr=#FF0000}${username}`);
        } else {
            chat.log(`{clr=#00FFFF}+ ${title} (${time}) added by {clr=#FF0000}${username}`);
        }

        refreshQueue();
    });
    client.on('unqueue', ({ item }) => {
        // chat.log(`{clr=#008888}- ${item.media.title} unqueued`);
        refreshQueue();
    });

    client.on('play', async ({ message: { item, time } }) => {
        if (!item) {
            player.stopPlaying();
        } else {
            player.setPlaying(item, time || 0);

            const { title, duration } = item.media;
            chat.log(`{clr=#00FFFF}> ${title} (${secondsToTime(duration / 1000)})`);
        }
    });

    client.on('join', (event) => chat.status(`{clr=#FF0000}${event.user.name} {clr=#FF00FF}joined`));
    client.on('leave', (event) => chat.status(`{clr=#FF0000}${event.user.name}{clr=#FF00FF} left`));
    client.on('status', (event) => chat.status(event.text));

    client.on('avatar', ({ local, data }) => {
        if (local) localStorage.setItem('avatar', data);
    });
    client.on('chat', (message) => {
        const { user, text } = message;
        chat.log(`{clr=#FF0000}${user.name}:{-clr} ${text}`);
        if (!message.local) {
            notify(user.name || 'anonymous', text, 'chat');
        }
    });
    client.on('rename', (message) => {
        if (message.local) {
            chat.status(`you are {clr=#FF0000}${message.user.name}`);
        } else {
            chat.status(`{clr=#FF0000}${message.previous}{clr=#FF00FF} is now {clr=#FF0000}${message.user.name}`);
        }
    });

    client.on('blocks', ({ coords }) => sceneRenderer.rebuildAtCoords(coords));

    setInterval(() => client.heartbeat(), 30 * 1000);

    function moveTo(x: number, y: number, z: number) {
        const user = getLocalUser()!;
        user.position = [x, y, z];
        client.move(user.position);
    }

    function move(dx: number, dz: number) {
        const user = getLocalUser()!;

        if (user.position) {
            const [px, py, pz] = user.position;
            let [nx, ny, nz] = [px + dx, py, pz + dz];

            const grid = client.zone.grid;

            const block = grid.has([nx, ny, nz]);
            const belowMe = grid.has([px, py - 1, pz]);
            const aboveMe = grid.has([px, py + 1, pz]);
            const belowBlock = grid.has([nx, ny - 1, nz]);
            const belowBlock2 = grid.has([nx, ny - 2, nz]);
            const aboveBlock = grid.has([nx, ny + 1, nz]);

            const walled =
                grid.has([nx - 1, ny, nz]) ||
                grid.has([nx + 1, ny, nz]) ||
                grid.has([nx, ny, nz - 1]) ||
                grid.has([nx, ny, nz + 1]);

            // walk into empty space along floor
            if (!block && belowBlock) {
                // great
                // special step down
            } else if (belowMe && !block && !belowBlock && belowBlock2) {
                ny -= 1;
                // walk into empty space along wall
            } else if (!block && walled) {
                // great
                // walk up wall
            } else if (block && aboveBlock && !aboveMe) {
                nx = px;
                nz = pz;
                ny = py + 1;
                // step up
            } else if (block && !aboveBlock && !aboveMe) {
                ny += 1;
                // fall down wall
            } else if (!block && !belowMe && !walled && !belowBlock) {
                nx = px;
                nz = pz;
                ny = py - 1;
                // step down
            } else if (!block && !belowBlock) {
                ny -= 1;
                // can't move
            } else {
                nx = px;
                ny = py;
                nz = pz;
            }

            moveTo(nx, ny, nz);
        }
    }

    function playFromSearchResult(args: string) {
        const index = parseInt(args, 10) - 1;

        if (isNaN(index)) chat.status(`did not understand '${args}' as a number`);
        else if (!lastSearchResults || index < 0 || index >= lastSearchResults.length)
            chat.status(`there is no #${index + 1} search result`);
        else client.youtube(lastSearchResults[index].videoId);
    }

    document.getElementById('play-banger')?.addEventListener('click', () => client.messaging.send('banger', {}));

    document.getElementById('blocks-button')!.addEventListener('click', () => htmlui.showWindowById('blocks-panel'));
    const blockListContainer = document.getElementById('blocks-list') as HTMLElement;

    const blockButtons: HTMLElement[] = [];
    const setBlock = (blockId: number) => {
        sceneRenderer.buildBlock = blockId;
        for (let i = 0; i < 8; ++i) {
            blockButtons[i].classList.toggle('selected', i === blockId);
        }
    };

    const addBlockButton = (element: HTMLElement, blockId: number) => {
        element.addEventListener('click', () => setBlock(blockId));
        blockListContainer.appendChild(element);
        blockButtons.push(element);
    };

    const tileset = document.createElement('img');
    tileset.src = './tileset.png';
    tileset.addEventListener('load', () => {
        const eraseImage = document.createElement('img');
        eraseImage.src = './erase-tile.png';
        addBlockButton(eraseImage, 0);

        tilemapContext.drawImage(tileset, 0, 0);
        blockTexture.needsUpdate = true;
        for (let i = 1; i < 8; ++i) {
            const context = createContext2D(8, 16);
            context.drawImage(tilemapContext.canvas, -(i - 1) * 16, 0);
            addBlockButton(context.canvas, i);
        }

        setBlock(1);
    });

    const avatarPanel = document.querySelector('#avatar-panel') as HTMLElement;
    const avatarName = document.querySelector('#avatar-name') as HTMLInputElement;
    const avatarPaint = document.querySelector('#avatar-paint') as HTMLCanvasElement;
    const avatarUpdate = document.querySelector('#avatar-update') as HTMLButtonElement;
    const avatarContext = avatarPaint.getContext('2d')!;

    function openAvatarEditor() {
        avatarName.value = getLocalUser()?.name || '';
        const avatar = getTile(getLocalUser()!.avatar) || avatarImage;
        avatarContext.clearRect(0, 0, 8, 8);
        avatarContext.drawImage(avatar.canvas, 0, 0);
        avatarPanel.hidden = false;
    }

    let painting = false;
    let erase = false;

    function paint(px: number, py: number) {
        withPixels(avatarContext, (pixels) => (pixels[py * 8 + px] = erase ? 0 : 0xffffffff));
    }

    window.addEventListener('pointerup', (event) => {
        if (painting) {
            painting = false;
            event.preventDefault();
            event.stopPropagation();
        }
    });
    avatarPaint.addEventListener('pointerdown', (event) => {
        painting = true;

        const scaling = 8 / avatarPaint.clientWidth;
        const [cx, cy] = eventToElementPixel(event, avatarPaint);
        const [px, py] = [Math.floor(cx * scaling), Math.floor(cy * scaling)];

        withPixels(avatarContext, (pixels) => {
            erase = pixels[py * 8 + px] > 0;
        });

        paint(px, py);

        event.preventDefault();
        event.stopPropagation();
    });
    avatarPaint.addEventListener('pointermove', (event) => {
        if (painting) {
            const scaling = 8 / avatarPaint.clientWidth;
            const [cx, cy] = eventToElementPixel(event, avatarPaint);
            const [px, py] = [Math.floor(cx * scaling), Math.floor(cy * scaling)];
            paint(px, py);
        }
    });

    avatarUpdate.addEventListener('click', () => {
        if (avatarName.value !== getLocalUser()?.name) rename(avatarName.value);
        client.avatar(blitsy.encodeTexture(avatarContext, 'M1').data);
    });

    let lastSearchResults: YoutubeVideo[] = [];

    const skipButton = document.getElementById('skip-button') as HTMLButtonElement;
    document.getElementById('avatar-button')?.addEventListener('click', () => openAvatarEditor());
    skipButton.addEventListener('click', () => client.skip());
    document.getElementById('resync-button')?.addEventListener('click', () => player.forceRetry('reload button'));

    const chatCommands = new Map<string, (args: string) => void>();
    chatCommands.set('search', async (query) => {
        lastSearchResults = await client.search(query);
        const lines = lastSearchResults
            .slice(0, 5)
            .map(({ title, duration }, i) => `${i + 1}. ${title} (${secondsToTime(duration / 1000)})`);
        chat.log('{clr=#FFFF00}? queue Search result with /result n\n{clr=#00FFFF}' + lines.join('\n'));
    });
    chatCommands.set('result', playFromSearchResult);
    chatCommands.set('s', chatCommands.get('search')!);
    chatCommands.set('r', chatCommands.get('result')!);
    chatCommands.set('youtube', (args) => {
        const videoId = textToYoutubeVideoId(args)!;
        client.youtube(videoId).catch(() => chat.status("couldn't queue video :("));
    });
    chatCommands.set('local', (path) => client.local(path));
    chatCommands.set('skip', () => client.skip());
    chatCommands.set('password', (args) => (joinPassword = args));
    chatCommands.set('users', () => listUsers());
    chatCommands.set('help', () => listHelp());
    chatCommands.set('lucky', (query) => client.lucky(query));
    chatCommands.set('avatar', (data) => {
        if (data.trim().length === 0) {
            openAvatarEditor();
        } else {
            client.avatar(data);
        }
    });
    chatCommands.set('avatar2', (args) => {
        const ascii = args.replace(/\s+/g, '\n');
        const avatar = blitsy.decodeAsciiTexture(ascii, '1');
        const data = blitsy.encodeTexture(avatar, 'M1').data;
        client.avatar(data);
    });
    chatCommands.set('volume', (args) => setVolume(parseInt(args.trim(), 10)));
    chatCommands.set('resync', () => player.forceRetry('user request'));
    chatCommands.set('notify', async () => {
        const permission = await Notification.requestPermission();
        chat.status(`notifications ${permission}`);
    });
    chatCommands.set('name', rename);
    chatCommands.set('banger', () => client.messaging.send('banger', {}));

    chatCommands.set('auth', (password) => client.auth(password));
    chatCommands.set('admin', (args) => {
        const i = args.indexOf(' ');

        if (i >= 0) {
            const name = args.substring(0, i);
            const json = `[${args.substring(i + 1)}]`;
            client.command(name, JSON.parse(json));
        } else {
            client.command(args);
        }
    });

    chatCommands.set('echo', (message) => client.echo(getLocalUser()!.position!, message));

    const emoteToggles = new Map<string, Element>();
    const toggleEmote = (emote: string) => setEmote(emote, !getEmote(emote));
    const getEmote = (emote: string) => emoteToggles.get(emote)!.classList.contains('active');
    const setEmote = (emote: string, value: boolean) => {
        emoteToggles.get(emote)!.classList.toggle('active', value);
        client.emotes(['wvy', 'shk', 'rbw', 'spn'].filter(getEmote));
    };

    document.querySelectorAll('[data-emote-toggle]').forEach((element) => {
        const emote = element.getAttribute('data-emote-toggle');
        if (!emote) return;
        emoteToggles.set(emote, element);
        element.addEventListener('click', () => toggleEmote(emote));
    });

    let fullChat = false;
    const chatToggle = document.getElementById('chat-toggle') as HTMLButtonElement;
    chatToggle.addEventListener('click', (event) => {
        event.stopPropagation();

        fullChat = !fullChat;
        chatToggle.classList.toggle('active', fullChat);
        if (fullChat) {
            chatInput.hidden = false;
            chatInput.focus();
            chatContext.canvas.classList.toggle('open', true);
        } else {
            chatInput.hidden = true;
            chatInput.blur();
            chatContext.canvas.classList.toggle('open', false);
        }
    });

    const directions: [number, number][] = [
        [1, 0],
        [0, -1],
        [-1, 0],
        [0, 1],
    ];

    function moveVector(direction: number): [number, number] {
        return directions[(direction + sceneRenderer.rotateStep) % 4];
    }

    const gameKeys = new Map<string, () => void>();
    gameKeys.set('Tab', () => chatToggle.click());
    gameKeys.set('1', () => toggleEmote('wvy'));
    gameKeys.set('2', () => toggleEmote('shk'));
    gameKeys.set('3', () => toggleEmote('rbw'));
    gameKeys.set('4', () => toggleEmote('spn'));
    gameKeys.set('ArrowLeft', () => move(...moveVector(2)));
    gameKeys.set('ArrowRight', () => move(...moveVector(0)));
    gameKeys.set('ArrowDown', () => move(...moveVector(3)));
    gameKeys.set('ArrowUp', () => move(...moveVector(1)));

    const rot = Math.PI / 4;

    document.getElementById('rotate-l-button')?.addEventListener('click', () => (sceneRenderer.followCam.angle -= rot));
    document.getElementById('rotate-r-button')?.addEventListener('click', () => (sceneRenderer.followCam.angle += rot));

    gameKeys.set('[', () => (sceneRenderer.followCam.angle -= rot));
    gameKeys.set(']', () => (sceneRenderer.followCam.angle += rot));
    gameKeys.set('v', () => sceneRenderer.cycleCamera());

    gameKeys.set('q', () => {
        refreshQueue();
        queuePanel.hidden = !queuePanel.hidden;
    });
    gameKeys.set('s', () => {
        searchPanel.hidden = false;
        searchInput.focus();
    });
    gameKeys.set('u', () => (userPanel.hidden = !userPanel.hidden));

    function sendChat() {
        const line = chatInput.value;
        const slash = line.match(/^\/(\w+)(.*)/);

        if (slash) {
            const command = chatCommands.get(slash[1]);
            if (command) {
                command(slash[2].trim());
            } else {
                chat.status(`no command /${slash[1]}`);
                listHelp();
            }
        } else if (line.length > 0) {
            client.chat(parseFakedown(line));
        }

        chatInput.value = '';
    }

    function isInputElement(element: Element | null): element is HTMLInputElement {
        return element?.tagName === 'INPUT';
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (isInputElement(document.activeElement)) {
                if (fullChat) {
                    chatToggle.click();
                } else {
                    document.activeElement.blur();
                }

                event.preventDefault();
            }
            htmlui.hideAllWindows();
        }

        if (isInputElement(document.activeElement)) {
            if (event.key === 'Tab' && document.activeElement === chatInput) {
                chatToggle.click();
                event.preventDefault();
            } else if (event.key === 'Enter') {
                sendChat();
            }
        } else {
            const func = gameKeys.get(event.key);
            if (func) {
                func();
                event.stopPropagation();
                event.preventDefault();
            }
        }
    });

    const playerStatus = document.getElementById('player-status')!;
    const chatContext = document.querySelector<HTMLCanvasElement>('#chat-canvas')!.getContext('2d')!;
    chatContext.imageSmoothingEnabled = false;

    chatContext.canvas.addEventListener('click', (event) => {
        if (fullChat) {
            event.preventDefault();
            event.stopPropagation();
            chatToggle.click();
        }
    });

    function redraw() {
        refreshCurrentItem();
        playerStatus.innerHTML = player.status;
        chatContext.clearRect(0, 0, 512, 512);

        chat.render(fullChat);
        chatContext.drawImage(chat.context.canvas, 0, 0, 512, 512);

        window.requestAnimationFrame(redraw);
    }

    redraw();

    setupEntrySplash();

    function connecting() {
        const socket = (client.messaging as any).socket;
        const state = socket ? socket.readyState : 0;

        return state !== WebSocket.OPEN;
    }

    const sceneRenderer = new ZoneSceneRenderer(
        document.getElementById('three-container')!,
        client,
        client.zone,
        getTile,
        connecting,
    );

    function renderScene() {
        requestAnimationFrame(renderScene);

        sceneRenderer.building = !htmlui.idToWindowElement.get('blocks-panel')!.hidden;

        sceneRenderer.mediaElement = popoutPanel.hidden && player.hasVideo ? video : zoneLogo;
        sceneRenderer.update();
        sceneRenderer.render();
    }

    renderScene();

    document.getElementById('camera-button')!.addEventListener('click', () => sceneRenderer.cycleCamera());

    const tooltip = document.getElementById('tooltip')!;
    sceneRenderer.on('pointerdown', (info) => {
        const objectCoords = info.objectCoords?.join(',') || '';
        const echoes = Array.from(client.zone.echoes)
            .map(([, echo]) => echo)
            .filter((echo) => echo.position!.join(',') === objectCoords);

        if (echoes.length > 0) {
            chat.log(`{clr=#808080}"${parseFakedown(echoes[0].text)}"`);
        } else if (info.spaceCoords) {
            const [x, y, z] = info.spaceCoords;
            moveTo(x, y, z);
        }
    });
    sceneRenderer.on('pointermove', (info) => {
        const objectCoords = info.objectCoords?.join(',') || '';

        if (objectCoords) {
            const users = Array.from(client.zone.users.values()).filter(
                (user) => user.position?.join(',') === objectCoords,
            );
            const echoes = Array.from(client.zone.echoes)
                .map(([, echo]) => echo)
                .filter((echo) => echo.position!.join(',') === objectCoords);

            const names = [
                ...users.map((user) => formatName(user)),
                ...echoes.map((echo) => 'echo of ' + formatName(echo)),
            ];
            tooltip.innerHTML = names.join(', ');
        } else {
            tooltip.innerHTML = '';
        }
    });
}

function setupEntrySplash() {
    const entrySplash = document.getElementById('entry-splash') as HTMLElement;
    const entryUsers = document.getElementById('entry-users') as HTMLParagraphElement;
    const entryButton = document.getElementById('entry-button') as HTMLInputElement;
    const entryForm = document.getElementById('entry') as HTMLFormElement;

    function updateEntryUsers() {
        fetch('./users')
            .then((res) => res.json())
            .then((names: string[]) => {
                if (names.length === 0) {
                    entryUsers.innerHTML = 'zone is currenty empty';
                } else {
                    entryUsers.innerHTML = `${names.length} people are zoning: ` + names.join(', ');
                }
            });
    }
    updateEntryUsers();
    setInterval(updateEntryUsers, 5000);

    entryButton.disabled = false;
    entryForm.addEventListener('submit', (e) => {
        e.preventDefault();
        entrySplash.hidden = true;
        enter();
    });
}

let zoneURL = '';
async function enter() {
    localName = (document.querySelector('#join-name') as HTMLInputElement).value;
    localStorage.setItem('name', localName);
    const urlparams = new URLSearchParams(window.location.search);
    zoneURL = urlparams.get('zone') || `${window.location.host}/zone`;
    await connect();
}
