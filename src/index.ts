import crypto from "crypto";
import events from "events";
import fs from "fs";
import https from "https";
import uniRest from "unirest";

import { ping, ServerAdvertisement } from "bedrock-protocol";

import authPkg from "prismarine-auth";
const { Authflow, Titles } = authPkg;

import wsPkg from "websocket";
const { w3cwebsocket: W3CWebSocket } = wsPkg;

const Constants = {
	SERVICE_CONFIG_ID: "4fc10100-5f7a-4470-899b-280835760c07", // The service config ID for Minecraft
	PEOPLE: "https://social.xboxlive.com/users/me/people",
	PEOPLE_HUB: "https://peoplehub.xboxlive.com/users/me/people",
	HANDLE: "https://sessiondirectory.xboxlive.com/handles",
	CONNECTIONS: "https://sessiondirectory.xboxlive.com/connections",
	RTA_SOCKET: "wss://rta.xboxlive.com/socket",
	LIVE_TOKEN_REQUEST: "https://login.live.com/oauth20_token.srf",
	AUTH_TITLE: "00000000441cc96b", // Nintendo Switch Title ID
};

interface SessionInfoOptions {
	keepVersionAndProtocolConstant: boolean;
	hostName: string;
	worldName: string;
	version: string;
	protocol: number;
	players: number;
	maxPlayers: number;
	ip: string;
	port: number;
	log?: boolean;
	connectionType: number;
	autoFriending: boolean;
	email: string;
}

interface Connection {
	ConnectionType: number;
	HostIpAddress: string;
	HostPort: number;
	RakNetGUID: string;
}

interface SessionRequestOptions {
	properties: {
		system: {
			joinRestriction: "followed";
			readRestriction: "followed";
			closed: false;
		};
		custom: {
			BroadcastSetting: 3;
			CrossPlayDisabled: false;
			Joinability: string | "joinable_by_friends";
			LanGame: true;
			MaxMemberCount: number;
			MemberCount: number;
			OnlineCrossPlatformGame: true;
			SupportedConnections: Connection[];
			TitleId: 0;
			TransportLayer: 0;
			levelId: "level";
			hostName: string;
			ownerId: string; //xuid
			rakNetGUID: string;
			worldName: string;
			worldType: "Survival";
			protocol: number;
			version: string;
		};
	};
	members: {
		me: {
			constants: {
				system: {
					xuid: string;
					initialize: true;
				};
			};
			properties: {
				system: {
					active: true;
					connection: string; // connectionId
					subscription: {
						id: "845CC784-7348-4A27-BCDE-C083579DD113";
						changeTypes: ["everything"];
					};
				};
			};
		};
	};
}

interface SessionInfo {
	keepVersionAndProtocolConstant: boolean;
	hostName: string;
	worldName: string;
	version: string;
	protocol: number;
	players: number;
	maxPlayers: number;
	ip: string;
	port: number;
	rakNetGUID: string;
	sessionId: string;
	xuid: string;
	connectionId: string;
	connectionType: number;
	autoFriending: boolean;
	log: boolean;
}

interface Token {
	userXUID: string;
	userHash: string;
	XSTSToken: string;
	expiresOn: number;
}

interface sessionRef {
	scid: string;
	templateName: string;
	name: string;
}

interface CreateHandleRequest {
	version: number;
	type: string;
	sessionRef: sessionRef;
}

interface People {
	xuid: string;
	addedDateTimeUtc: string;
	isFavorite: boolean;
	isKnown: boolean;
	socialNetworks: string[];
	isFollowedByCaller: boolean;
	isFollowingCaller: boolean;
	isUnfollowingFeed: boolean;
}

interface PeopleList {
	totalCount: number;
	people: People[];
}

const XboxLive = class {
	token: Token;
	get tokenHeader(): string {
		return `XBL3.0 x=${this.token.userHash};${this.token.XSTSToken}`;
	}
	constructor(token: Token) {
		this.token = token;
	} //TODO: Add Error handling to each
	addFriend(xuid: string) {
		https
			.request(Constants.PEOPLE + `/xuid(${xuid})`,  {
				method: "PUT",
				headers: {
					Authorization: this.tokenHeader,
				},
			}, (res) => {
				//console.log(res.statusCode, res.statusMessage);
				res.on("error", (err) => {
					console.log("Add Friend:\n", err);
				});
			})
			.end();
	}
	removeFriend(xuid: string) {//TODO: fix this
		https
			.request(Constants.PEOPLE + `/xuid(${xuid})`, {
				method: "DELETE",
				headers: {
					Authorization: this.tokenHeader,
				},
			}, (res) => {
				res.on("error", (err) => {
					console.log("Remove Friend:\n", err);
				});
			})
			.end();
	}
};

//console.log(new XboxLive(token).tokenHeader);

//TODO updating player number and motd

class Session extends events.EventEmitter {
	SessionInfo: SessionInfo;
	sessionStarted: boolean = false;
	token: Token;
	xblInstance;
	constructor(options: SessionInfoOptions) {
		super();
		this.refreshXblToken(options.email);

		this.on("tokenRefreshed", (token) => {
			this.token = token;
			console.log("Connecting...");
			this.SessionInfo = this.createSessionInfo(options);
			this.xblInstance = new XboxLive(this.token);
			var ws = new W3CWebSocket(
				"wss://rta.xboxlive.com/connect",
				"echo-protocol",
				undefined,
				{
					Authorization: `XBL3.0 x=${this.token.userHash};${this.token.XSTSToken}`,
				}
			);
			ws.onerror = (error) => {
				console.log("Error: ", error.message);
				console.log("Connection Error");

				new Session(options);
			};

			ws.onopen = () => {
				console.log("Connected");
				ws.send(
					'[1,1,"https://sessiondirectory.xboxlive.com/connections/"]'
				);
				if (options.log) console.log("WebSocket Client Connected");
			};
			ws.onclose = (event) => {
				if (options.log) {
					console.log("WebSocket Client Closed");
					console.log("Code: " + event.code);
					console.log("Reason: " + event.reason);
					console.log("Clean Exit: " + event.wasClean);
				}

				if (options.log) console.log("Restarting...");
				new Session(options);
			};

			ws.onmessage = (event) => {
				if (options.log) console.log(event.data);
				switch (typeof event.data) {
					case "string":
						const data = JSON.parse(event.data);

						if (event.data.includes("ConnectionId")) {
							this.SessionInfo.connectionId =
								data[4].ConnectionId;
							this.emit("connectionId");
						} else {
							if (options.log)
								console.log(
									"----------------------------------- Start of RTA WS Message\n",
									event.data,
									"\n----------------------------------- End of RTA WS Message"
								);
						}
				}
			};

			this.on("connectionId", () => {
				//console.log(this.SessionInfo.connectionId);
				this.updateSession();
			});
			this.on("sessionUpdated", () => {
				if (!this.sessionStarted) {
					if (options.log)
						console.log(
							"----------------------------------- Start of Handle Request"
						);
					var createHandleRequestOptions = {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: this.xblInstance.tokenHeader,
							"x-xbl-contract-version": 107,
						},
					};

					var createHandleContent = this.createHandleRequest(
						1,
						"activity",
						{
							scid: Constants.SERVICE_CONFIG_ID,
							templateName: "MinecraftLobby",
							name: this.SessionInfo.sessionId,
						}
					);

					var createHandleRequest = https.request(
						Constants.HANDLE,
						createHandleRequestOptions,
						(res) => {
							//console.log("statusCode:", res.statusCode);
							//console.log("headers:", res.headers);
							res.on("data", (data) => {
								if (options.log)
									console.log(
										data.toString(),
										"\n----------------------------------- End of Handle Request"
									);
							});
						}
					);

					createHandleRequest.write(
						JSON.stringify(createHandleContent)
					);

					createHandleRequest.on("error", (e) => {
						//console.error(e);
						//console.log("----------------------------------- End of Handle Request");
					});
					createHandleRequest.end();
					this.sessionStarted = true;
					this.emit("sessionStarted");
				}
			});
			this.on("sessionStarted", () => {
				if (options.log) console.log("Session started");

				setInterval(() => {
					this.updateSession(this.SessionInfo);
				}, 60000);
				if (options.autoFriending)
					setInterval(() => {
						if (options.log) console.log("Friend Interval");
						let request = https.request(
							Constants.PEOPLE_HUB + "/followers",
							{
								method: "GET",
								headers: {
									Authorization: this.xblInstance.tokenHeader,
									"x-xbl-contract-version": 5,
									"Accept-Language": "en-us",
								},
							},
							(res) => {
								//console.log(res.statusCode, res.statusMessage);
								var body = "";
								res.on("data", function (chunk) {
									body += chunk;
								});

								res.on("end", () => {
									try {
										let data: PeopleList = JSON.parse(body);

										for (let i of data.people) {
											if (i.isFollowingCaller) {
												if (!i.isFollowedByCaller)
													this.xblInstance.addFriend(
														i.xuid
													);
											} else {
												this.xblInstance.removeFriend(
													i.xuid
												);
											}
										}
									} catch (e) {
										console.log(e);
									}
								});

								res.on("error", (err) => {
									console.log("Get People:\n", err);
								});
							}
						);
						request.on("error", (err) => {
							console.log("Get People:\n", err);
						});
						request.end();
					}, 10000);
			});
		});
	}

	async refreshXblToken(email:string) {
		try {
			let authDir = fs.readdirSync("./auth");
			let liveCache = JSON.parse(
				fs.readFileSync(`./auth/${authDir[0]}`, "utf8")
			);

			const req = uniRest("POST", Constants.LIVE_TOKEN_REQUEST);

			req.headers({
				"Content-Type": "application/x-www-form-urlencoded",
			});

			req.form({
				scope: liveCache.token.scope,
				client_id: Constants.AUTH_TITLE,
				grant_type: "refresh_token",
				refresh_token: liveCache.token.refresh_token,
			});
			req.end((res) => {
				fs.writeFileSync(
					`./auth/${authDir[0]}`,
					JSON.stringify({ token: res.body }),
					"utf8"
				);
				try {
					fs.unlinkSync(`./auth/${authDir[1]}`);
				} catch {}

				new Authflow(email, "./auth", {
					authTitle: Titles.MinecraftNintendoSwitch,
					deviceType: "Nintendo",
				})
					.getXboxToken()
					.then((token) => {
						this.emit("tokenRefreshed", token);
					});
			});
		} catch {
			new Authflow(email, "./auth", {
				authTitle: Titles.MinecraftNintendoSwitch,
				deviceType: "Nintendo",
			})
				.getXboxToken()
				.then((token) => {
					this.emit("tokenRefreshed", token);
				});
		}
	}
	createSessionInfo(options: SessionInfoOptions): SessionInfo {
		if (options.log) console.log("Creating Session Info");
		return {
			hostName: options.hostName,
			worldName: options.worldName,
			version: options.version,
			protocol: options.protocol,
			players: options.players,
			maxPlayers: options.maxPlayers,
			ip: options.ip,
			port: options.port,
			rakNetGUID: "",
			sessionId: crypto.randomUUID(),
			xuid: this.token.userXUID,
			connectionId: "",
			connectionType: options.connectionType,
			keepVersionAndProtocolConstant:
				options.keepVersionAndProtocolConstant,
			autoFriending: options.autoFriending,
			log: options.log,
		};
	}

	updateSessionInfo(options: SessionInfo) {
		for (const key in options) {
			this.SessionInfo[key] = options[key];
		}
	}

	async getAdvertisement(): Promise<ServerAdvertisement> {
		let info;
		try {
			info = await ping({
				host: this.SessionInfo.ip,
				port: this.SessionInfo.port,
			});
		} catch (e) {
			info = {
				motd: this.SessionInfo.worldName,
				name: this.SessionInfo.hostName,
				protocol: this.SessionInfo.protocol,
				version: this.SessionInfo.version,
				playersOnline: this.SessionInfo.players,
				playersMax: this.SessionInfo.maxPlayers,
				gamemode: "survival",
				serverId: "",
			};
		}

		if (this.SessionInfo.keepVersionAndProtocolConstant) {
			info.version = this.SessionInfo.version;
			info.protocol = this.SessionInfo.protocol;
		}
		return info;
	}

	async createSessionRequest(): Promise<SessionRequestOptions> {
		//TODO: delete this
		console.log("Creating Session Request");

		const info = await this.getAdvertisement();

		return {
			properties: {
				system: {
					joinRestriction: "followed",
					readRestriction: "followed",
					closed: false,
				},
				custom: {
					BroadcastSetting: 3,
					CrossPlayDisabled: false,
					Joinability: "joinable_by_friends",
					LanGame: true,
					MaxMemberCount:
						parseInt(info.playersMax.toString()) ||
						this.SessionInfo.maxPlayers,
					MemberCount:
						parseInt(info.playersOnline.toString()) ||
						this.SessionInfo.players,
					OnlineCrossPlatformGame: true,
					SupportedConnections: [
						{
							ConnectionType: this.SessionInfo.connectionType,
							HostIpAddress: this.SessionInfo.ip,
							HostPort: this.SessionInfo.port,

							RakNetGUID: "",
						},
					],
					TitleId: 0,
					hostName: this.SessionInfo.hostName,
					ownerId: this.SessionInfo.xuid,
					rakNetGUID: "",
					worldName: this.SessionInfo.worldName,
					worldType: "Survival",
					protocol: this.SessionInfo.protocol,
					version: this.SessionInfo.version,
					levelId: "level",
					TransportLayer: 0,
				},
			},
			members: {
				me: {
					constants: {
						system: {
							xuid: this.SessionInfo.xuid,
							initialize: true,
						},
					},
					properties: {
						system: {
							active: true,
							connection: this.SessionInfo.connectionId,
							subscription: {
								id: "845CC784-7348-4A27-BCDE-C083579DD113",
								changeTypes: ["everything"],
							},
						},
					},
				},
			},
		};
	}

	createHandleRequest(version: number, type: string, sessionRef: sessionRef) {
		return {
			version: version,
			type: type,
			sessionRef: sessionRef,
		};
	}

	async updateSession(sessionInfo?: SessionInfo) {
		if (sessionInfo) {
			this.getAdvertisement().then((advertisement) => {
				sessionInfo.worldName =
					advertisement.name || sessionInfo.worldName;
				sessionInfo.players =
					parseInt(advertisement.playersOnline.toString()) ||
					sessionInfo.players;
				(sessionInfo.maxPlayers =
					parseInt(advertisement.playersMax.toString()) ||
					sessionInfo.maxPlayers),
					(sessionInfo.version = advertisement.version);
				sessionInfo.protocol = advertisement.protocol;
				console.log(advertisement);
				this.updateSessionInfo(sessionInfo);
				console.log(this.SessionInfo);
			});
		}

		if (sessionInfo && sessionInfo.log) console.log("updateSession");

		var createSessionContent = await this.createSessionRequest();
		//console.log(createSessionContent);
		const options = {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: this.xblInstance.tokenHeader,
				"x-xbl-contract-version": 107,
			},
		};

		//console.log(options);
		let uri =
			"https://sessiondirectory.xboxlive.com/serviceconfigs/" +
			Constants.SERVICE_CONFIG_ID +
			"/sessionTemplates/MinecraftLobby/sessions/" +
			this.SessionInfo.sessionId;

		const createSessionRequest = https.request(uri, options, (res) => {
			if (sessionInfo && sessionInfo.log)
				console.log(
					"----------------------------------- Start of Update Session"
				);
			if (sessionInfo && sessionInfo.log)
				console.log("statusCode:", res.statusCode);
			//console.log("headers:", res.headers);

			res.on("data", (d) => {
				if (sessionInfo && sessionInfo.log) console.log("data:", d);
				if (sessionInfo && sessionInfo.log)
					console.log(
						"----------------------------------- End of Update Session"
					);
				this.emit("sessionUpdated");
			});

			res.on("error", (err) => {
				console.error(err);
				console.log(
					"----------------------------------- End of Update Session"
				);
			});
		});
		createSessionRequest.write(JSON.stringify(createSessionContent));

		createSessionRequest.on("error", (e) => {
			console.error("createSessionRequest Error: ", e);
		});
		createSessionRequest.end();
	}
}
export { Session };
