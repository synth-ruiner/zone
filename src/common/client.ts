import Messaging from './messaging';
import { EventEmitter } from 'events';
import { YoutubeVideo } from '../server/youtube';
import { specifically } from './utility';
import { ZoneState, UserState, QueueItem, UserEcho } from './zone';
import fetch from 'node-fetch';

export type StatusMesage = { text: string };
export type JoinMessage = { name: string; token?: string; password?: string };
export type AssignMessage = { userId: string; token: string };
export type RejectMessage = { text: string };
export type UsersMessage = { users: UserState[] };
export type LeaveMessage = { userId: string };
export type PlayMessage = { item: QueueItem; time: number };
export type QueueMessage = { items: QueueItem[] };
export type UnqueueMessage = { itemId: number };

export type SendChat = { text: string };
export type RecvChat = { text: string; userId: string };

export type SendAuth = { password: string };
export type SendCommand = { name: string; args: any[] };

export type BlocksMessage = { cells: [number[], number][] };
export type BlockMessage = { coords: number[]; value: number };

export type EchoMessage = { position: number[]; text: string };
export type EchoesMessage = { added?: UserEcho[]; removed?: number[][] };

export type DataMessage = { update: any };

export interface MessageMap {
    heartbeat: {};
    assign: AssignMessage;
    reject: RejectMessage;
    users: UsersMessage;
    leave: LeaveMessage;
    play: PlayMessage;
    queue: QueueMessage;

    chat: SendChat;
    user: UserState;

    block: BlockMessage;
    blocks: BlocksMessage;
    echoes: EchoesMessage;
}

export interface ClientOptions {
    urlRoot: string;
    quickResponseTimeout: number;
    slowResponseTimeout: number;
    joinName?: string;
}

export const DEFAULT_OPTIONS: ClientOptions = {
    urlRoot: '.',
    quickResponseTimeout: 1000,
    slowResponseTimeout: 5000,
};

export interface ClientEventMap {
    disconnect: (event: { clean: boolean }) => void;
    joined: (event: { user: UserState }) => void;

    chat: (event: { user: UserState; text: string; local: boolean }) => void;
    join: (event: { user: UserState }) => void;
    leave: (event: { user: UserState }) => void;
    rename: (event: { user: UserState; previous: string; local: boolean }) => void;
    status: (event: { text: string }) => void;

    play: (event: { message: PlayMessage }) => void;
    queue: (event: { item: QueueItem }) => void;
    unqueue: (event: { item: QueueItem }) => void;

    move: (event: { user: UserState; position: number[]; local: boolean }) => void;
    emotes: (event: { user: UserState; emotes: string[]; local: boolean }) => void;
    avatar: (event: { user: UserState; data: string; local: boolean }) => void;
    tags: (event: { user: UserState; tags: string[]; local: boolean }) => void;

    blocks: (event: { coords: number[][] }) => void;
}

export interface ZoneClient {
    on<K extends keyof ClientEventMap>(event: K, callback: ClientEventMap[K]): this;
    off<K extends keyof ClientEventMap>(event: K, callback: ClientEventMap[K]): this;
    once<K extends keyof ClientEventMap>(event: K, callback: ClientEventMap[K]): this;
    emit<K extends keyof ClientEventMap>(event: K, ...args: Parameters<ClientEventMap[K]>): boolean;
}

export class ZoneClient extends EventEmitter {
    readonly options: ClientOptions;
    readonly messaging = new Messaging();
    readonly zone = new ZoneState();

    localUser?: UserState;

    private assignation?: AssignMessage;

    constructor(options: Partial<ClientOptions> = {}) {
        super();
        this.options = Object.assign({}, DEFAULT_OPTIONS, options);
        this.addStandardListeners();
    }

    get localUserId() {
        return this.assignation?.userId;
    }

    clear() {
        this.zone.clear();
    }

    async expect<K extends keyof MessageMap>(type: K, timeout?: number): Promise<MessageMap[K]> {
        return new Promise((resolve, reject) => {
            if (timeout) setTimeout(() => reject('timeout'), timeout);
            this.messaging.messages.once(type, (message) => resolve(message));
        });
    }

    async join(options: { name?: string; token?: string; password?: string } = {}) {
        this.clear();
        options.name = options.name || this.options.joinName || 'anonymous';
        options.token = options.token || this.assignation?.token;

        return new Promise<AssignMessage>((resolve, reject) => {
            this.expect('assign', this.options.quickResponseTimeout).then(resolve, reject);
            this.expect('reject').then(reject);
            this.messaging.send('join', options);
        }).then((assign) => {
            this.assignation = assign;
            this.localUser = this.zone.getUser(assign.userId);
            this.emit('joined', { user: this.localUser });
            return assign;
        });
    }

    async heartbeat() {
        return new Promise<{}>((resolve, reject) => {
            this.expect('heartbeat', this.options.quickResponseTimeout).then(resolve, reject);
            this.messaging.send('heartbeat', {});
        });
    }

    async auth(password: string) {
        this.messaging.send('auth', { password });
    }

    async command(name: string, args: any[] = []) {
        this.messaging.send('command', { name, args });
    }

    async rename(name: string): Promise<UserState> {
        return new Promise((resolve, reject) => {
            setTimeout(() => reject('timeout'), this.options.quickResponseTimeout);
            specifically(
                this.messaging.messages,
                'user',
                (message: UserState) => message.userId === this.localUserId && message.name === name,
                resolve,
            );
            this.messaging.send('user', { name });
        });
    }

    async chat(text: string) {
        this.messaging.send('chat', { text });
    }

    async move(position: number[]) {
        this.messaging.send('user', { position });
    }

    async avatar(avatar: string) {
        this.messaging.send('user', { avatar });
    }

    async emotes(emotes: string[]) {
        this.messaging.send('user', { emotes });
    }

    async setBlock(coords: number[], value: number) {
        this.messaging.send('block', { coords, value });
    }

    async echo(position: number[], text: string) {
        this.messaging.send('echo', { position, text });
    }

    async search(query: string): Promise<YoutubeVideo[]> {
        const url = this.options.urlRoot + '/youtube?q=' + encodeURIComponent(query);
        return fetch(url).then(async (res) => {
            if (res.ok) return res.json();
            throw new Error(await res.text());
        });
    }

    async lucky(query: string) {
        return new Promise<QueueMessage>((resolve, reject) => {
            this.expect('queue', this.options.slowResponseTimeout).then(resolve, reject);
            this.messaging.send('lucky', { query });
        });
    }

    async youtube(videoId: string) {
        return new Promise<QueueItem>((resolve, reject) => {
            setTimeout(() => reject('timeout'), this.options.slowResponseTimeout);
            this.on('queue', ({ item }) => {
                if (item.media.source === 'youtube/' + videoId) resolve(item);
            });
            this.messaging.send('youtube', { videoId });
        });
    }

    async local(path: string) {
        return new Promise<QueueItem>((resolve, reject) => {
            setTimeout(() => reject('timeout'), this.options.quickResponseTimeout);
            this.once('queue', ({ item }) => resolve(item));
            this.messaging.send('local', { path });
        });
    }

    async unqueue(item: QueueItem) {
        return new Promise<QueueItem>((resolve, reject) => {
            setTimeout(() => reject('timeout'), this.options.quickResponseTimeout);
            specifically(this, 'unqueue', (unqueued: QueueItem) => unqueued.itemId === unqueued.itemId, resolve);
            this.messaging.send('unqueue', { itemId: item.itemId });
        });
    }

    async skip() {
        if (!this.zone.lastPlayedItem) return;
        const source = this.zone.lastPlayedItem.media.source;
        this.messaging.send('skip', { source });
    }

    private addStandardListeners() {
        const unqueue = (itemId: number) => {
            const index = this.zone.queue.findIndex((item) => item.itemId === itemId);
            if (index >= 0) {
                const [item] = this.zone.queue.splice(index, 1);
                this.emit('unqueue', { item });
            }
        };
        this.messaging.on('close', (code) => {
            const clean = code <= 1001 || code >= 4000;
            this.emit('disconnect', { clean });
        });
        this.messaging.messages.on('status', (message: StatusMesage) => {
            this.emit('status', { text: message.text });
        });
        this.messaging.messages.on('leave', (message: LeaveMessage) => {
            const user = this.zone.getUser(message.userId);
            this.zone.users.delete(message.userId);
            this.emit('leave', { user });
        });
        this.messaging.messages.on('users', (message: UsersMessage) => {
            this.zone.users.clear();
            message.users.forEach((user: UserState) => {
                this.zone.users.set(user.userId, user);
            });
        });
        this.messaging.messages.on('blocks', (message: BlocksMessage) => {
            const coords: number[][] = [];
            message.cells.forEach(([coord, block]) => {
                this.zone.grid.set(coord, block);
                coords.push(coord);
            });
            this.emit('blocks', { coords });
        });
        this.messaging.messages.on('block', (message: BlockMessage) => {
            if (message.value) {
                this.zone.grid.set(message.coords, message.value);
            } else {
                this.zone.grid.delete(message.coords);
            }
            this.emit('blocks', { coords: [message.coords] });
        });
        this.messaging.messages.on('echoes', (message: EchoesMessage) => {
            if (message.added) {
                message.added.forEach((echo) => this.zone.echoes.set(echo.position!, echo));
            } else if (message.removed) {
                message.removed.forEach((coord) => this.zone.echoes.delete(coord));
            }
        });
        this.messaging.messages.on('chat', (message: RecvChat) => {
            const user = this.zone.getUser(message.userId);
            const local = user.userId === this.localUserId;
            this.emit('chat', { user, text: message.text, local });
        });
        this.messaging.messages.on('play', (message: PlayMessage) => {
            this.zone.lastPlayedItem = message.item;
            if (message.item) unqueue(message.item.itemId);
            this.emit('play', { message });
        });
        this.messaging.messages.on('queue', (message: QueueMessage) => {
            this.zone.queue.push(...message.items);
            if (message.items.length === 1) this.emit('queue', { item: message.items[0] });
        });
        this.messaging.messages.on('unqueue', (message: UnqueueMessage) => {
            unqueue(message.itemId);
        });
        this.messaging.messages.on('user', (message: UserState) => {
            const user = this.zone.getUser(message.userId);
            const local = user.userId === this.localUserId;

            const prev = { ...user };
            const { userId, ...changes } = message;

            if (local && prev.position) delete changes.position;

            Object.assign(user, changes);

            if (!prev.name) {
                this.emit('join', { user });
            } else if (prev.name !== user.name) {
                this.emit('rename', { user, local, previous: prev.name });
            }

            if (changes.position) this.emit('move', { user, local, position: changes.position });
            if (changes.emotes) this.emit('emotes', { user, local, emotes: changes.emotes });
            if (changes.avatar) this.emit('avatar', { user, local, data: changes.avatar });
            if (changes.tags) this.emit('tags', { user, local, tags: changes.tags });
        });
    }
}

export default ZoneClient;
