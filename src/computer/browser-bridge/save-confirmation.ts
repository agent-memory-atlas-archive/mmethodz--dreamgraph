/** Windows Chrome's post-picker file-type confirmation; scoped to a known Save, never a general prompt accepter. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { homedir } from "node:os";
import type { FileDialogResult } from "./transport.js";

/** Chrome does not expose stable UIA IDs for these buttons. Only verified label pairs are admitted. */
export const SAVE_CONFIRMATION_LABELS = [["Save", "Don't save"], ["Tallenna", "Älä tallenna"]] as const;
export function saveConfirmationIdentity(path: string, origin: string) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password)
    throw new Error("BROWSER_SAVE_CONFIRMATION_ORIGIN_INVALID");
  const filename = win32.basename(path), extension = win32.extname(filename);
  if (!win32.isAbsolute(path) || !filename || !extension) throw new Error("BROWSER_SAVE_CONFIRMATION_PATH_INVALID");
  return { filename, extension, origin };
}

export const WINDOWS_SAVE_CONFIRMATION_SCRIPT = String.raw`param([string]$FileName, [string]$Extension, [string]$Origin, [string]$Labels)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Result([string]$Status,[string]$Message) { [Console]::Out.Write((@{status=$Status;message=$Message}|ConvertTo-Json -Compress)); exit 0 }
trap { Result 'failed' $_.Exception.Message }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$S = [System.Windows.Automation.TreeScope]
$T = [System.Windows.Automation.Condition]::TrueCondition
$pairs = ConvertFrom-Json $Labels
$browserIds = @(Get-Process -Name chrome,msedge,brave,chromium -ErrorAction SilentlyContinue | ForEach-Object {$_.Id})
$saveButtons = @()
foreach($window in $A::RootElement.FindAll($S::Children,$T)) {
  if($browserIds -notcontains $window.Current.ProcessId -or $window.Current.ClassName -ne 'Chrome_WidgetWin_1'){continue}
  $roots = $window.FindAll($S::Descendants,(New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty,'RootView')))
  foreach($root in $roots) {
    $nodes = @($root.FindAll($S::Descendants,$T))
    # Browser-owned modal Views only: page DOM/accessibility trees are excluded.
    if(@($nodes | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document}).Count -ne 0){continue}
    if(@($nodes | Where-Object {$_.Current.ClassName -eq 'DialogClientView'}).Count -ne 1){continue}
    if(@($nodes | Where-Object {$_.Current.ClassName -eq 'BubbleFrameView'}).Count -ne 1){continue}
    $texts = @($nodes | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text} | ForEach-Object {$_.Current.Name})
    $filePattern = '(?<![\p{L}\p{N}_.-])' + [regex]::Escape($FileName) + '(?![\p{L}\p{N}_.-])'
    if(-not @($texts | Where-Object {$_ -cmatch $filePattern}).Count -or $texts -cnotcontains $Origin -or $texts -cnotcontains $Extension){continue}
    $buttons = @($nodes | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button})
    if($buttons.Count -ne 2){continue}
    foreach($pair in $pairs) {
      $yes = @($buttons | Where-Object {$_.Current.Name -ceq $pair[0] -and $_.Current.ClassName -eq 'MdTextButton' -and $_.Current.FrameworkId -eq 'Chrome' -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen})
      $no = @($buttons | Where-Object {$_.Current.Name -ceq $pair[1] -and $_.Current.ClassName -eq 'MdTextButton'})
      if($yes.Count -eq 1 -and $no.Count -eq 1){$saveButtons += $yes[0]}
    }
  }
}
if($saveButtons.Count -ne 1){Result 'needs_confirmation' ('No unique matching browser Save confirmation; observed '+$saveButtons.Count+'. No button pressed.')}
$button=$saveButtons[0]
$pattern=$null
if(-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){Result 'needs_confirmation' 'Save button cannot be invoked. No button pressed.'}
([System.Windows.Automation.InvokePattern]$pattern).Invoke()
Result 'done' 'Matching browser file-type Save confirmation accepted; page completion must still be observed.'
`;

export async function answerSaveConfirmation(input: { path: string; origin: string }, options: { home?: string; platform?: NodeJS.Platform } = {}): Promise<FileDialogResult> {
  const identity = saveConfirmationIdentity(input.path, input.origin);
  if ((options.platform ?? process.platform) !== "win32") return { status: "unsupported", message: "Browser Save confirmation is currently qualified on Windows." };
  const folder = join(options.home ?? homedir(), ".dreamgraph", "browser");
  await mkdir(folder, { recursive: true });
  const script = join(folder, "save-confirmation.ps1"); await writeFile(script, WINDOWS_SAVE_CONFIRMATION_SCRIPT, "utf8");
  try {
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
      "-FileName", identity.filename, "-Extension", identity.extension, "-Origin", identity.origin, "-Labels", JSON.stringify(SAVE_CONFIRMATION_LABELS)],
      { windowsHide: true, timeout: 10000, maxBuffer: 32768 });
    const result = JSON.parse(stdout.trim()) as FileDialogResult;
    if (!["done", "needs_confirmation", "failed"].includes(result.status)) throw new Error("INVALID_CONFIRMATION_RESULT");
    return result;
  } catch (error) { return { status: "failed", message: "Browser Save confirmation unconfirmed: " + String(error).slice(0, 500) }; }
}
