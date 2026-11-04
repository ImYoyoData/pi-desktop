import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ompAgentDir } from "./omp-dir";

type SessionDirInfo = {
	encodedDirName: string;
	hashedDirName: string;
	shadowedHomeDirName?: string;
	shadowedHomeHashedDirName?: string;
};

const migratedSessionRoots = new Set<string>();

function canonicalPath(target: string): string {
	try {
		return fs.realpathSync(target);
	} catch {
		return path.resolve(target);
	}
}

function isRelativeWithin(relative: string): boolean {
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function encodeRelative(prefix: string, relative: string): string {
	const encoded = relative.replace(/[/\\:]/g, "-");
	if (!encoded) return prefix;
	return prefix.endsWith("-") ? `${prefix}${encoded}` : `${prefix}-${encoded}`;
}

export function ompLegacySessionDirName(cwd: string): string {
	const resolved = path.resolve(cwd);
	return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function hashedSessionDirName(
	canonicalCwd: string,
	scope: "home" | "tmp" | "abs",
): string {
	const normalized = canonicalCwd.replaceAll("\\", "/");
	const readable = path
		.basename(canonicalCwd)
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(-80);
	const digest = createHash("sha256").update(normalized).digest("hex");
	return `${scope}-${readable || "project"}-${digest}`;
}

function sessionDirInfo(cwd: string): SessionDirInfo {
	const resolved = path.resolve(cwd);
	const canonicalCwd = canonicalPath(resolved);
	const home = canonicalPath(os.homedir());
	const tempRoot = canonicalPath(os.tmpdir());
	const homeRelative = path.relative(home, canonicalCwd);
	const tempRelative = path.relative(tempRoot, canonicalCwd);
	const inHome = isRelativeWithin(homeRelative);

	if (isRelativeWithin(tempRelative)) {
		return {
			encodedDirName: encodeRelative("-tmp", tempRelative),
			hashedDirName: hashedSessionDirName(canonicalCwd, "tmp"),
			...(inHome
				? {
						shadowedHomeDirName: encodeRelative("-", homeRelative),
						shadowedHomeHashedDirName: hashedSessionDirName(canonicalCwd, "home"),
					}
				: {}),
		};
	}
	if (inHome) {
		return {
			encodedDirName: encodeRelative("-", homeRelative),
			hashedDirName: hashedSessionDirName(canonicalCwd, "home"),
		};
	}
	return {
		encodedDirName: ompLegacySessionDirName(resolved),
		hashedDirName: hashedSessionDirName(canonicalCwd, "abs"),
	};
}

function migrateSessionDirPath(oldPath: string, newPath: string): void {
	const existing = fs.statSync(newPath, { throwIfNoEntry: false });
	if (existing?.isDirectory()) {
		for (const file of fs.readdirSync(oldPath)) {
			const src = path.join(oldPath, file);
			const dest = path.join(newPath, file);
			if (fs.existsSync(dest)) continue;
			fs.renameSync(src, dest);
		}
		fs.rmdirSync(oldPath);
		return;
	}
	if (existing) fs.rmSync(newPath, { recursive: true, force: true });
	fs.renameSync(oldPath, newPath);
}

function migrateNamedSessionDir(
	legacyDirName: string,
	sessionDir: string,
	sessionsRoot: string,
): void {
	const legacyDir = path.join(sessionsRoot, legacyDirName);
	if (legacyDir === sessionDir || !fs.existsSync(legacyDir)) return;
	try {
		migrateSessionDirPath(legacyDir, sessionDir);
	} catch {
		// 迁移失败时保留旧目录，会话仍可被 SDK 找到。
	}
}

function migrateHomeSessionDirs(sessionsRoot: string): void {
	if (migratedSessionRoots.has(sessionsRoot)) return;
	migratedSessionRoots.add(sessionsRoot);

	const home = os.homedir();
	const homeEncoded = home.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
	const oldPrefix = `--${homeEncoded}-`;
	const oldExact = `--${homeEncoded}--`;

	let entries: string[];
	try {
		entries = fs.readdirSync(sessionsRoot);
	} catch {
		return;
	}

	for (const entry of entries) {
		let remainder: string;
		if (entry === oldExact) {
			remainder = "";
		} else if (entry.startsWith(oldPrefix) && entry.endsWith("--")) {
			remainder = entry.slice(oldPrefix.length, -2);
		} else {
			continue;
		}
		const newName = remainder ? `-${remainder}` : "-";
		const oldPath = path.join(sessionsRoot, entry);
		const newPath = path.join(sessionsRoot, newName);
		try {
			migrateSessionDirPath(oldPath, newPath);
		} catch {
			// 迁移失败时保留旧目录，下一次访问再试。
		}
	}
}

export function ompSessionDirName(cwd: string): string {
	return sessionDirInfo(cwd).encodedDirName;
}

export function ensureOmpSessionDir(cwd: string, create = false): string {
	const resolved = path.resolve(cwd);
	const info = sessionDirInfo(resolved);
	const sessionsRoot = path.join(ompAgentDir(), "sessions");
	migrateHomeSessionDirs(sessionsRoot);
	const sessionDir = path.join(sessionsRoot, info.encodedDirName);
	migrateNamedSessionDir(ompLegacySessionDirName(resolved), sessionDir, sessionsRoot);
	if (info.shadowedHomeDirName) {
		migrateNamedSessionDir(info.shadowedHomeDirName, sessionDir, sessionsRoot);
	}
	if (info.shadowedHomeHashedDirName) {
		migrateNamedSessionDir(info.shadowedHomeHashedDirName, sessionDir, sessionsRoot);
	}
	migrateNamedSessionDir(info.hashedDirName, sessionDir, sessionsRoot);
	if (create) fs.mkdirSync(sessionDir, { recursive: true });
	return sessionDir;
}
