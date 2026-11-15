# SI-assisted: written with Claude (Anthropic). Generates the synthetic narration (Windows text-to-speech, voice Microsoft Zira).
param([string]$Out)
Add-Type -AssemblyName System.Speech
$lines = @(
 "For twenty-five years, two NASA satellites have watched Earth's fires. But they measure them differently.",
 "VIIRS sees four times more fire than MODIS. So the raw record shows a jump in 2012 that never happened.",
 "Ember Atlas calibrates MODIS to VIIRS, region by region, season by season. One record, on one scale.",
 "Now any country or province gets an honest burning calendar: when it burns, and which months were unusual.",
 "Ember Atlas. One fire record for the whole planet."
)
$i = 1
foreach ($l in $lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice("Microsoft Zira Desktop"); $s.Rate = 1
  $s.SetOutputToWaveFile("$Out\line$i.wav"); $s.Speak($l); $s.Dispose(); $i++
}
