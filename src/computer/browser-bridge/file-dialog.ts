/**
 * Answers the browser's OS file dialog (File System Access save/open/folder picker) on the desktop.
 * Windows: Windows PowerShell with a small Win32 helper (built into Windows; no extra install). The bottom panel of
 * the common file dialog is plain Win32 controls with fixed ids in every language: the file name dropdown is
 * control 1148 with its text field inside, Save/Open is 1 and Cancel 2 (UI Automation may not expose them at all).
 * The dialog takes the name only from real keyboard input, so the script focuses that field, verifies the dialog is
 * in front with the field focused, types the path as Unicode key events (any layout), re-checks focus as it types,
 * reads the field back, and only then sends the Save command. Nothing is matched by visible text, and the folder
 * view (where item names are editable) is never touched. An overwrite confirmation is answered by button id
 * (6 = Yes, 7 = No). Other platforms report "unsupported".
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { FileDialogRequest, FileDialogResult } from "./transport.js";

const run = promisify(execFile);

export const WINDOWS_FILE_DIALOG_SCRIPT = String.raw`param([string]$Action = 'choose', [string]$Path = '', [switch]$Overwrite, [int]$TimeoutMs = 8000)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Send-Result([string]$Status, [string]$Message) { [Console]::Out.Write((@{ status = $Status; message = $Message } | ConvertTo-Json -Compress)); exit 0 }
trap { Send-Result 'failed' ("{0} (script line {1})" -f $_.Exception.Message, $_.InvocationInfo.ScriptLineNumber) }
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace DreamGraph {
  public static class Dlg {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    static uint ThreadOf(IntPtr h) { uint pid; return GetWindowThreadProcessId(h, out pid); }
    /** The window with keyboard focus in h's thread. */
    public static IntPtr FocusOf(IntPtr h) { GUITHREADINFO info = new GUITHREADINFO(); info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO)); return GetGUIThreadInfo(ThreadOf(h), ref info) ? info.hwndFocus : IntPtr.Zero; }
    /** Gives h keyboard focus within its own thread (attaching input briefly, as Windows requires across threads). */
    public static void Focus(IntPtr h) { uint me = GetCurrentThreadId(), them = ThreadOf(h); bool attached = AttachThreadInput(me, them, true); SetFocus(h); if (attached) AttachThreadInput(me, them, false); }
    /** Types text as Unicode key events (independent of keyboard layout and language). */
    public static void TypeUnicode(string text) {
      INPUT[] inputs = new INPUT[text.Length * 2];
      for (int i = 0; i < text.Length; i++) {
        inputs[2 * i].type = 1; inputs[2 * i].u.ki.wScan = text[i]; inputs[2 * i].u.ki.dwFlags = 4;
        inputs[2 * i + 1].type = 1; inputs[2 * i + 1].u.ki.wScan = text[i]; inputs[2 * i + 1].u.ki.dwFlags = 4 | 2;
      }
      SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
    public static string ClassOf(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
    public static string TitleOf(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
    public static int ProcessOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return (int)pid; }
    public static int BottomOf(IntPtr h) { RECT r; GetWindowRect(h, out r); return r.Bottom; }
    public static List<IntPtr> TopLevel() { List<IntPtr> list = new List<IntPtr>(); EnumWindows(delegate (IntPtr h, IntPtr l) { list.Add(h); return true; }, IntPtr.Zero); return list; }
    public static List<IntPtr> Descendants(IntPtr p) { List<IntPtr> list = new List<IntPtr>(); EnumChildWindows(p, delegate (IntPtr h, IntPtr l) { list.Add(h); return true; }, IntPtr.Zero); return list; }
    public static string TextOf(IntPtr h) {
      IntPtr length; SendMessageTimeout(h, 0x000E, IntPtr.Zero, IntPtr.Zero, 2, 1000, out length);
      int size = length.ToInt32() + 2; StringBuilder s = new StringBuilder(size); IntPtr copied;
      SendMessageTimeout(h, 0x000D, (IntPtr)size, s, 2, 1000, out copied); return s.ToString();
    }
    public static void TypeText(IntPtr h, string text) { IntPtr result; foreach (char c in text) SendMessageTimeout(h, 0x0102, (IntPtr)c, IntPtr.Zero, 2, 1000, out result); }
    public static bool SetText(IntPtr h, string text) { IntPtr result; return SendMessageTimeout(h, 0x000C, IntPtr.Zero, text, 2, 2000, out result) != IntPtr.Zero; }
    public static void Command(IntPtr target, int id, IntPtr control) { PostMessage(target, 0x0111, (IntPtr)id, control); }
    public static void TaskDialogClick(IntPtr dialog, int id) { PostMessage(dialog, 0x0466, (IntPtr)id, IntPtr.Zero); }
  }
}
"@
$D = [DreamGraph.Dlg]
$browserIds = @(Get-Process -Name chrome, msedge, brave, chromium -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$Zero = [IntPtr]::Zero
function Describe([IntPtr]$Handle) { "{0}#{1}(visible={2},enabled={3})" -f $D::ClassOf($Handle), $D::GetDlgCtrlID($Handle), $D::IsWindowVisible($Handle), $D::IsWindowEnabled($Handle) }
# The browser's file dialog: a visible top-level #32770 of a browser process that is not owned by another #32770
# (the overwrite confirmation is owned by the file dialog).
function Find-FileDialog {
  foreach ($handle in $D::TopLevel()) {
    if (-not $D::IsWindowVisible($handle) -or $D::ClassOf($handle) -ne '#32770') { continue }
    if ($browserIds -notcontains $D::ProcessOf($handle)) { continue }
    $owner = $D::GetWindow($handle, 4)
    if (($owner -ne $Zero) -and ($D::ClassOf($owner) -eq '#32770')) { continue }
    return $handle
  }
  return $Zero
}
function Owned-Dialogs([IntPtr]$Owner) {
  @($D::TopLevel() | Where-Object { $D::IsWindowVisible($_) -and ($D::ClassOf($_) -eq '#32770') -and ($D::GetWindow($_, 4) -eq $Owner) })
}
function Find-Button([IntPtr]$Root, [int]$Id) {
  foreach ($handle in $D::Descendants($Root)) {
    if (($D::ClassOf($handle) -eq 'Button') -and ($D::GetDlgCtrlID($handle) -eq $Id) -and $D::IsWindowVisible($handle)) { return $handle }
  }
  return $Zero
}
# Sends a button's command to its dialog, as a click does.
function Press([IntPtr]$Dialog, [int]$Id) {
  $button = Find-Button $Dialog $Id
  if ($button -ne $Zero) { $D::Command($D::GetParent($button), $Id, $button) } else { $D::Command($Dialog, $Id, $Zero) }
}
# The browser opens the dialog without focus; bring it forward so the user sees what happens (nothing here needs
# focus). Windows only lets a background process do that right after an input event, hence the unused F24 key.
function Bring-Forward([IntPtr]$Handle) {
  try { $D::keybd_event(0x87, 0, 0, [UIntPtr]::Zero); $D::keybd_event(0x87, 0, 2, [UIntPtr]::Zero); [void]$D::ShowWindow($Handle, 9); [void]$D::SetForegroundWindow($Handle) } catch { }
}
# The folder the dialog shows (the address bar's text includes the path), for messages only.
function Folder-Shown([IntPtr]$Dialog) {
  foreach ($handle in $D::Descendants($Dialog)) {
    if ($D::ClassOf($handle) -ne 'ToolbarWindow32') { continue }
    $text = $D::TextOf($handle)
    $match = [regex]::Match($text, '[A-Za-z]:\\.*$')
    if ($match.Success) { return $match.Value }
  }
  return 'unknown'
}
function Message-Text([IntPtr]$Handle) {
  $text = @($D::Descendants($Handle) | Where-Object { $D::ClassOf($_) -eq 'Static' } | ForEach-Object { $D::TextOf($_) } | Where-Object { $_ }) -join ' '
  if (-not $text) {
    try {
      Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
      $element = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
      $textType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
      $text = (@($element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textType)) | ForEach-Object { $_.Current.Name }) -join ' '
    } catch { }
  }
  if (-not $text) { $text = $D::TitleOf($Handle) }
  return $text
}
# Answers a confirmation the file dialog shows: a message box (Win32 buttons) or a task dialog (button ids only).
function Answer-Confirmation([IntPtr]$Handle, [int]$Id) {
  if ((Find-Button $Handle $Id) -ne $Zero) { Press $Handle $Id; return }
  if (((Find-Button $Handle 6) -ne $Zero) -or ((Find-Button $Handle 7) -ne $Zero)) { Press $Handle 2; return }
  $D::TaskDialogClick($Handle, $Id)
  Start-Sleep -Milliseconds 300
  if ($D::IsWindow($Handle) -and $D::IsWindowVisible($Handle)) { $D::TaskDialogClick($Handle, 2); $D::Command($Handle, 2, $Zero) }
}

$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
$dialog = $Zero
while (($dialog -eq $Zero) -and ([DateTime]::UtcNow -lt $deadline)) { $dialog = Find-FileDialog; if ($dialog -eq $Zero) { Start-Sleep -Milliseconds 200 } }
if ($dialog -eq $Zero) { Send-Result 'not_found' 'No file dialog of the browser is open.' }
$title = $D::TitleOf($dialog)
Bring-Forward $dialog
if ($Action -eq 'cancel') { Press $dialog 2; Send-Result 'cancelled' $title }

# The file name field: the text field (Edit) inside the dialog's file name dropdown, control 1148 (in every language).
# Otherwise the bottom-most visible text field inside a dropdown; the address bar (control 41477) is at the top.
$candidates = @()
foreach ($handle in $D::Descendants($dialog)) {
  if (($D::ClassOf($handle) -ne 'Edit') -or -not $D::IsWindowVisible($handle) -or -not $D::IsWindowEnabled($handle)) { continue }
  $combo = $D::GetParent($handle)
  if ($D::ClassOf($combo) -ne 'ComboBox') { continue }
  $comboHost = $D::GetParent($combo)
  if (($D::GetDlgCtrlID($combo) -eq 41477) -or ($D::GetDlgCtrlID($comboHost) -eq 41477)) { continue }
  $score = - $D::BottomOf($handle)
  if (($D::GetDlgCtrlID($combo) -eq 1148) -or ($D::GetDlgCtrlID($comboHost) -eq 1148)) { $score -= 200000 }
  $candidates += [pscustomobject]@{ Handle = $handle; Score = $score }
}
if ($candidates.Count -eq 0) {
  $seen = @($D::Descendants($dialog) | Where-Object { $D::IsWindowVisible($_) } | ForEach-Object { Describe $_ } | Select-Object -Unique -First 40)
  Send-Result 'failed' ("No file name field found in '$title'; nothing was changed. Controls: " + ($seen -join ', '))
}
$field = ($candidates | Sort-Object Score | Select-Object -First 1).Handle
# The dialog takes the name only from real keyboard input (text set or sent to the field as messages is shown but
# ignored on Save). So: focus the field, verify the dialog is in front and the field has focus, and type the path as
# Unicode key events (any keyboard layout), re-checking focus as it types; never type when focus is elsewhere.
function Field-Has-Focus { ($D::GetAncestor($D::GetForegroundWindow(), 2) -eq $dialog) -and ($D::FocusOf($field) -eq $field) }
[void]$D::SetText($field, '')
Bring-Forward $dialog
$D::Focus($field)
Start-Sleep -Milliseconds 150
if (-not (Field-Has-Focus)) {
  Bring-Forward $dialog; $D::Focus($field); Start-Sleep -Milliseconds 300
  if (-not (Field-Has-Focus)) { Send-Result 'failed' ("The file dialog could not be brought to the front with its file name field focused; nothing was typed. Foreground: " + (Describe $D::GetForegroundWindow()) + ", focus: " + (Describe $D::FocusOf($field))) }
}
for ($at = 0; $at -lt $Path.Length; $at += 8) {
  if (-not (Field-Has-Focus)) { [void]$D::SetText($field, ''); Send-Result 'failed' 'Keyboard focus left the file name field while typing (another window or click?); typing stopped and the field was cleared. Try again.' }
  $D::TypeUnicode($Path.Substring($at, [Math]::Min(8, $Path.Length - $at)))
  Start-Sleep -Milliseconds 30
}
Start-Sleep -Milliseconds 200
$current = $D::TextOf($field)
if ($current -ne $Path) { Send-Result 'failed' ("The file name field holds '" + $current + "' instead of the requested path; Save was not pressed. Field: " + (Describe $field)) }
# Done: the dialog closed. (Its existence check proves nothing: the dialog itself creates and deletes a test file
# at the chosen path when Save is pressed; the page reports which file it received.)
function Send-Done { Send-Result 'done' $Path }
Press $dialog 1
$end = [DateTime]::UtcNow.AddMilliseconds(6000)
while ([DateTime]::UtcNow -lt $end) {
  Start-Sleep -Milliseconds 250
  if (-not $D::IsWindow($dialog) -or -not $D::IsWindowVisible($dialog)) { Send-Done }
  $message = Owned-Dialogs $dialog | Select-Object -First 1
  if ($null -ne $message) {
    $text = Message-Text $message
    if ($Overwrite) { Answer-Confirmation $message 6; $Overwrite = $false; Start-Sleep -Milliseconds 300; continue }
    Answer-Confirmation $message 7
    Send-Result 'needs_confirmation' ("$text (folder shown: $(Folder-Shown $dialog))")
  }
}
if (-not $D::IsWindow($dialog) -or -not $D::IsWindowVisible($dialog)) { Send-Done }
Send-Result 'still_open' "The dialog '$title' is still open after Save (file name field holds '$($D::TextOf($field))'; folder shown: $(Folder-Shown $dialog))."
`;

/**
 * Chrome refuses File System Access to system locations and shows its own "can't open files in this folder" page
 * instead of handing the file to the site. Checked before the dialog is touched so the model can pick another path.
 * Windows locations per Chrome's block list (app data, Program Files, Windows, ~/.ssh, ~/.gnupg).
 */
export function chromeBlockedLocation(path: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const normalize = (value: string) => value.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const target = normalize(path);
  const home = env.USERPROFILE ? normalize(env.USERPROFILE) : "";
  const blocked = [env.APPDATA, env.LOCALAPPDATA, env.windir ?? env.WINDIR, env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432,
    home && `${home}\\.ssh`, home && `${home}\\.gnupg`].filter((value): value is string => !!value).map(normalize);
  return blocked.find(root => target === root || target.startsWith(`${root}\\`)) ?? null;
}

export async function answerOsFileDialog(request: FileDialogRequest, options: { platform?: NodeJS.Platform; home?: string } = {}): Promise<FileDialogResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { status: "unsupported", message: "DreamGraph operates OS file dialogs on Windows only for now; ask the user to answer it" };
  const blocked = request.action !== "cancel" && request.path ? chromeBlockedLocation(request.path) : null;
  if (blocked) return { status: "failed", message: `the browser does not let sites use files in system folders (${blocked}); nothing was typed. Choose a path under Documents, Desktop, Downloads or a project folder` };
  const directory = join(options.home ?? homedir(), ".dreamgraph", "browser");
  await mkdir(directory, { recursive: true });
  const script = join(directory, "file-dialog.ps1");
  await writeFile(script, WINDOWS_FILE_DIALOG_SCRIPT, "utf8");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", request.action === "cancel" ? "cancel" : "choose",
    ...(request.path ? ["-Path", request.path] : []), ...(request.overwrite ? ["-Overwrite"] : [])];
  const parse = (stdout: string): FileDialogResult | null => {
    try { const parsed = JSON.parse(stdout.trim()) as FileDialogResult; return { status: parsed.status, ...(parsed.message ? { message: String(parsed.message).slice(0, 2000) } : {}) }; }
    catch { return null; }
  };
  try {
    const { stdout, stderr } = await run("powershell.exe", args, { windowsHide: true, timeout: 30_000, maxBuffer: 256 * 1024 });
    return parse(stdout) ?? { status: "failed", message: `no result from the dialog script: ${(stdout + stderr).trim().slice(0, 800)}` };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; killed?: boolean };
    const reported = parse(failure.stdout ?? "");
    if (reported) return reported;
    const output = `${failure.stderr ?? ""} ${failure.stdout ?? ""}`.replace(/\s+/g, " ").trim();
    return { status: "failed", message: `${failure.killed ? "the dialog script timed out" : "the dialog script failed"}: ${output || failure.message}`.slice(0, 800) };
  }
}
