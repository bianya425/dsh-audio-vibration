# Audio capture probe: WASAPI loopback on the default output device.
# Emits one JSON line per 50ms: {"peak":..,"rms":..,"bass":..,"bands":[32 spectrum bands]}.
# Requires NAudio.dll under %TEMP%\audio-vibration-lib.
# Reads volume/spectrum only; does not record or upload. Self-terminates when the parent DSH host exits.

$ErrorActionPreference = 'Stop'

$libDir = Join-Path $env:TEMP 'audio-vibration-lib'
$naudio = Join-Path $libDir 'NAudio.dll'

if (-not (Test-Path $naudio)) {
  Write-Output '{"error":"naudio-missing"}'
  exit 1
}

try {
  [System.Reflection.Assembly]::LoadFrom($naudio) | Out-Null
} catch {
  Write-Output ('{"error":"naudio-load-failed","message":"' + ($_.Exception.Message -replace '"', "'") + '"}')
  exit 1
}

$cs = @'
using System;
using System.Diagnostics;
using NAudio.Wave;
using NAudio.Dsp;

public static class AudioVibrationProbe
{
    private const int FftSize = 2048;
    private const int FftLog = 11;
    private const int Bands = 32;

    private static int _parentPid = 0;
    private static int _bitsPerSample = 32;

    private static readonly object Gate = new object();
    private static double _peak;
    private static double _energy;
    private static long _n;
    private static readonly float[] _samples = new float[FftSize];
    private static int _samplePos;

    public static void RunForever(int parentPid)
    {
        _parentPid = parentPid;
        WasapiLoopbackCapture cap = null;
        try
        {
            cap = new WasapiLoopbackCapture();
            _bitsPerSample = cap.WaveFormat.BitsPerSample;
            cap.DataAvailable += OnData;
            cap.StartRecording();
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"error\":\"capture-init-failed\",\"message\":\"" + Escape(ex.Message) + "\"}");
            if (cap != null) { try { cap.Dispose(); } catch { } }
            return;
        }
        Console.WriteLine("{\"ready\":true,\"device\":\"default\",\"bits\":" + _bitsPerSample + "}");
        Loop();
        try { cap.StopRecording(); } catch { }
        try { cap.Dispose(); } catch { }
    }

    private static string Escape(string s)
    {
        return (s ?? "").Replace("\\", "\\\\").Replace("\"", "'").Replace("\r", " ").Replace("\n", " ");
    }

    private static void Loop()
    {
        var bands = new double[Bands];
        while (true)
        {
            System.Threading.Thread.Sleep(50);
            if (_parentPid > 0 && !ParentAlive()) return;
            double p, rms;
            lock (Gate)
            {
                p = _peak;
                rms = Math.Sqrt(_n > 0 ? _energy / _n : 0);
                _peak = 0;
                _energy = 0;
                _n = 0;
                ComputeBandsLocked(bands);
            }
            // bass = average of the first few low-frequency bands, used to drive the stem glow
            double bass = 0;
            for (int b = 0; b < 4; b++) bass += bands[b];
            bass = Math.Min(1.0, bass / 4.0 * 1.6);
            Console.WriteLine(
                "{\"peak\":" + p.ToString("F4") +
                ",\"rms\":" + rms.ToString("F4") +
                ",\"bass\":" + bass.ToString("F4") +
                ",\"bands\":" + BandsJson(bands) + "}");
        }
    }

    private static void OnData(object sender, WaveInEventArgs e)
    {
        double peak = 0;
        double energy = 0;
        int cnt = 0;
        lock (Gate)
        {
            if (_bitsPerSample == 16)
            {
                cnt = e.BytesRecorded / 2;
                for (int i = 0; i + 1 < e.BytesRecorded; i += 2)
                {
                    short s = (short)(e.Buffer[i] | (e.Buffer[i + 1] << 8));
                    float f = s / 32768f;
                    PushSample(f);
                    double v = Math.Abs(f);
                    if (v > peak) peak = v;
                    energy += v * v;
                }
            }
            else
            {
                cnt = e.BytesRecorded / 4;
                for (int i = 0; i + 3 < e.BytesRecorded; i += 4)
                {
                    float f = BitConverter.ToSingle(e.Buffer, i);
                    PushSample(f);
                    double v = Math.Abs(f);
                    if (v > peak) peak = v;
                    energy += v * v;
                }
            }
            if (peak > _peak) _peak = peak;
            _energy += energy;
            _n += cnt;
        }
    }

    private static void PushSample(float f)
    {
        _samples[_samplePos] = f;
        _samplePos++;
        if (_samplePos >= FftSize) _samplePos = 0;
    }

    private static bool ParentAlive()
    {
        try
        {
            using (var proc = Process.GetProcessById(_parentPid))
            {
                return !proc.HasExited;
            }
        }
        catch
        {
            return false;
        }
    }

    // Caller must hold the Gate lock. Splits the FFT into 32 log-spaced bands
    // (perceptual frequency scale like Wallpaper Engine), each mapped to 0..1.
    private static void ComputeBandsLocked(double[] bands)
    {
        var c = new Complex[FftSize];
        for (int i = 0; i < FftSize; i++)
        {
            int idx = (_samplePos + i) % FftSize;
            double win = 0.54 - 0.46 * Math.Cos(2.0 * Math.PI * i / (FftSize - 1));
            c[i].X = (float)(_samples[idx] * win);
            c[i].Y = 0f;
        }
        try
        {
            FastFourierTransform.FFT(true, FftLog, c);
        }
        catch
        {
            for (int b = 0; b < Bands; b++) bands[b] = 0;
            return;
        }

        // Magnitudes of usable bins 1..N/2.
        int maxBin = FftSize / 2;
        var mag = new double[maxBin + 1];
        for (int i = 1; i <= maxBin; i++)
        {
            mag[i] = Math.Sqrt((double)c[i].X * c[i].X + (double)c[i].Y * c[i].Y);
        }

        // Log-spaced band edges from bin 2 (lowest useful) up to maxBin.
        double logLo = Math.Log(2.0);
        double logHi = Math.Log(maxBin);
        for (int b = 0; b < Bands; b++)
        {
            double f0 = Math.Exp(logLo + (logHi - logLo) * b / Bands);
            double f1 = Math.Exp(logLo + (logHi - logLo) * (b + 1) / Bands);
            int a = (int)Math.Floor(f0);
            int z = (int)Math.Ceiling(f1);
            if (a < 2) a = 2;
            if (z > maxBin) z = maxBin;
            if (z <= a) z = a + 1;
            double sum = 0;
            int n = 0;
            for (int i = a; i < z; i++)
            {
                sum += mag[i];
                n++;
            }
            double avg = n > 0 ? sum / n : 0;
            // Compensate the natural high-frequency rolloff so treble bars move as much as bass.
            double comp = Math.Pow(1.05, b);
            bands[b] = Math.Min(1.0, Math.Sqrt(avg) * 4.0 * comp);
        }
    }

    private static string BandsJson(double[] bands)
    {
        var sb = new System.Text.StringBuilder();
        sb.Append('[');
        for (int b = 0; b < Bands; b++)
        {
            if (b > 0) sb.Append(',');
            sb.Append(bands[b].ToString("F3"));
        }
        sb.Append(']');
        return sb.ToString();
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies @($naudio, 'System.dll')

# Parent PID: the probe exits when the DSH host dies, so it never becomes an orphan holding the shutdown flow.
$parentPid = 0
try {
  $parentPid = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
} catch {
  $parentPid = 0
}
[AudioVibrationProbe]::RunForever($parentPid)
