Computer Use Harness test — strictly bounded, target web64-ide-local only.

Use ONLY the prepared Harness target (the Web64 IDE served at http://localhost:5173/ide in the Harness's own fresh browser). Its default project is a disposable copy; nothing in it persists.

Steps:
1. Observe the IDE with a screenshot and read source-editor and emulator-status. Report which file is shown. Change nothing.
2. Replace the content of source-editor (type) with exactly this program:
start:
    lda #$09
    sta $d020
mainloop:
    lda #$03
    sta $d020
    lda #$0a
    sta $d020
    lda #$05
    sta $d020
    lda #$01
    sta $d020
    lda #$00
    sta $d020
    lda #$0b
    sta $d020
    jmp mainloop
3. Click start-prg. Wait until emulator-status shows the program is running, then take a screenshot and report whether the C64 border shows rapidly changing colors.
4. Click pause-emulator. Confirm the postconditions emulator-paused and debugger-open, and take a screenshot.

Hard limits:
- Use only the target's listed elements and operations. Do not try to reach other pages, tabs or sites.
- Do not use DreamGraph tools to edit any file in the repository; this is a Computer Use test only.
- At most 40 Computer Use actions. If an action is refused, a dialog appears, or a postcondition fails, stop and report exactly what happened.

Report: each step's result, the screenshots from steps 1, 3 and 4, the postcondition results, and the Computer Use usage (actions, screenshots).
