; Native multicolor bitmap primitives for the BASIC V2 ports.
; VIC bank $C000, screen/color matrix $CC00, bitmap $E000.
; BASIC remains at $0801. No zero-page workspace is used.
; Parameters $C7F0..$C7F4: x1,y1,x2,y2,color (0..3).
; Callers clamp coordinates to x=0..159, y=0..199.
; Four public JMP entries are fixed at $C000/$C003/$C006/$C009.
.org $C000
    JMP enter
    JMP text
    JMP line
    JMP fill

enter:
    PHP
    SEI
    LDA active
    BNE clear
    LDA $DD00
    STA savedbank
    LDA $DD02
    STA savedddr
    LDA $D011
    AND #$7F
    STA saved11
    LDA $D016
    STA saved16
    LDA $D018
    STA saved18
    LDA $D020
    STA saved20
    LDA $D021
    STA saved21
    LDA $D015
    STA savedsprites
    LDA $0286
    STA savedink
    LDA $CC
    STA savedcursor
    LDA #1
    STA active
clear:
    LDA #1
    STA $CC
    LDA $DD02
    ORA #3
    STA $DD02
    LDA $DD00
    AND #$FC
    STA $DD00
    LDA #$38
    STA $D018
    LDA $D011
    AND #$1F
    ORA #$20
    STA $D011
    LDA $D016
    ORA #$10
    STA $D016
    LDA #0
    STA $D015
    STA $D020
    STA $D021
    ; Writes reach RAM underneath KERNAL without unmapping ROM.
    LDA #$E0
    STA clearstore+2
    LDA #0
    LDX #0
clearpage:
clearstore:
    STA $E000,X
    INX
    BNE clearpage
    INC clearstore+2
    LDY clearstore+2
    CPY #$FF
    BNE clearpage
    LDX #63
clearlast:
    STA $FF00,X
    DEX
    BPL clearlast
    ; All cells: 01=yellow, 10=cyan, 11=white, 00=black.
    LDX #0
palette:
    LDA #$73
    STA $CC00,X
    STA $CD00,X
    STA $CE00,X
    STA $CF00,X
    LDA #1
    STA $D800,X
    STA $D900,X
    STA $DA00,X
    STA $DB00,X
    INX
    BNE palette
    ; Safe RAM NMI vector for the short ROM-hidden pixel access.
    LDA #<ramnmi
    STA $FFFA
    LDA #>ramnmi
    STA $FFFB
    PLP
    RTS

text:
    PHP
    LDA active
    BEQ textdone
    SEI
    LDA savedbank
    STA $DD00
    LDA savedddr
    STA $DD02
    LDA saved11
    STA $D011
    LDA saved16
    STA $D016
    LDA saved18
    STA $D018
    LDA saved20
    STA $D020
    LDA saved21
    STA $D021
    LDA savedsprites
    STA $D015
    LDA savedink
    STA $0286
    LDA savedcursor
    STA $CC
    LDA #0
    STA active
    ; Restore text screen and its foreground color RAM together.
    JSR $E544
textdone:
    PLP
    RTS

line:
    PHP
    CLD
    LDA $C7F0
    STA lx
    LDA $C7F1
    STA ly
    LDA #1
    STA sx
    STA sy
    LDA $C7F2
    SEC
    SBC lx
    BCS dxready
    EOR #$FF
    CLC
    ADC #1
    LDX #$FF
    STX sx
dxready:
    STA dx
    LDA $C7F3
    SEC
    SBC ly
    BCS dyready
    EOR #$FF
    CLC
    ADC #1
    LDX #$FF
    STX sy
dyready:
    STA dy
    LDA dx
    CMP dy
    BCC ymajor
    LSR A
    STA error
xloop:
    JSR pixel
    LDA lx
    CMP $C7F2
    BEQ linedone
    CLC
    ADC sx
    STA lx
    LDA error
    SEC
    SBC dy
    BCS xerror
    CLC
    ADC dx
    STA error
    LDA ly
    CLC
    ADC sy
    STA ly
    JMP xloop
xerror:
    STA error
    JMP xloop
ymajor:
    LDA dy
    LSR A
    STA error
yloop:
    JSR pixel
    LDA ly
    CMP $C7F3
    BEQ linedone
    CLC
    ADC sy
    STA ly
    LDA error
    SEC
    SBC dx
    BCS yerror
    CLC
    ADC dy
    STA error
    LDA lx
    CLC
    ADC sx
    STA lx
    JMP yloop
yerror:
    STA error
    JMP yloop
linedone:
    PLP
    RTS

fill:
    PHP
    CLD
    LDA $C7F0
    CMP $C7F2
    BCC xordered
    LDA $C7F2
    STA fx0
    LDA $C7F0
    STA fx1
    JMP yorder
xordered:
    STA fx0
    LDA $C7F2
    STA fx1
yorder:
    LDA $C7F1
    CMP $C7F3
    BCC yordered
    LDA $C7F3
    STA ly
    LDA $C7F1
    STA fy1
    JMP fillrow
yordered:
    STA ly
    LDA $C7F3
    STA fy1
fillrow:
    LDA fx0
    STA lx
fillpixel:
    JSR pixel
    LDA lx
    CMP fx1
    BEQ nextrow
    INC lx
    JMP fillpixel
nextrow:
    LDA ly
    CMP fy1
    BEQ filldone
    INC ly
    JMP fillrow
filldone:
    PLP
    RTS

pixel:
    ; Address = $E000+(y/8)*320+(x/4)*8+(y AND 7).
    LDA lx
    AND #$FC
    ASL A
    STA xlo
    LDA #0
    ROL A
    STA xhi
    LDA ly
    LSR A
    LSR A
    LSR A
    TAX
    LDA rowlo,X
    CLC
    ADC xlo
    STA readpixel+1
    STA writepixel+1
    LDA rowhi,X
    ADC xhi
    STA readpixel+2
    STA writepixel+2
    LDA ly
    AND #7
    CLC
    ADC readpixel+1
    STA readpixel+1
    STA writepixel+1
    LDA lx
    AND #3
    TAX
    LDA masks,X
    STA pixelmask+1
    TXA
    ASL A
    ASL A
    ORA $C7F4
    TAX
    LDA colors,X
    STA pixelcolor+1
    ; KERNAL ROM is hidden only for this byte's read/modify/write.
    PHP
    SEI
    LDA $01
    PHA
    AND #$FD
    STA $01
readpixel:
    LDA $E000
pixelmask:
    AND #$3F
pixelcolor:
    ORA #$40
writepixel:
    STA $E000
    PLA
    STA $01
    PLP
    RTS
ramnmi:
    PHA
    LDA $DD0D
    PLA
    RTI

rowlo:
    .byte 0,64,128,192,0,64,128,192,0,64,128,192,0
    .byte 64,128,192,0,64,128,192,0,64,128,192,0
rowhi:
    .byte 224,225,226,227,229,230,231,232,234,235,236,237,239
    .byte 240,241,242,244,245,246,247,249,250,251,252,254
masks:
    .byte 63,207,243,252
colors:
    .byte 0,64,128,192,0,16,32,48,0,4,8,12,0,1,2,3
active:
    .byte 0
savedbank:
    .byte 0
savedddr:
    .byte 0
saved11:
    .byte 0
saved16:
    .byte 0
saved18:
    .byte 0
saved20:
    .byte 0
saved21:
    .byte 0
savedsprites:
    .byte 0
savedink:
    .byte 0
savedcursor:
    .byte 0
lx:
    .byte 0
ly:
    .byte 0
sx:
    .byte 0
sy:
    .byte 0
dx:
    .byte 0
dy:
    .byte 0
error:
    .byte 0
fx0:
    .byte 0
fx1:
    .byte 0
fy1:
    .byte 0
xlo:
    .byte 0
xhi:
    .byte 0
