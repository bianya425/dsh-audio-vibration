# dsh-audio-vibration

A DeepSeek Harness (DSH) plugin that adds a dynamic audio spectrum visualizer to the sidebar. It captures local system audio via WASAPI loopback and generates real-time visual vibration effects.

## Features

-   **Real-time Visualization:** Displays a responsive audio spectrum bar.
-   **WASAPI Loopback:** Captures system-wide audio output directly.
-   **Lightweight:** Built with JavaScript and NAudio for minimal performance impact.

## Prerequisites

-   **Node.js:** Version >= 20
-   **DeepSeek Harness (DSH):** Ensure you have the DSH client installed.

## Installation

### Option 1: Install via DSH (Recommended)

If you are using the DSH client, you can install this plugin directly via the plugin manager or by adding it to your `cordis.patch.yml`.

### Option 2: Manual Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/bianya425/dsh-audio-vibration.git

    ```
2.  Navigate to the plugin directory:
    ```bash
    cd dsh-audio-vibration/dsh-audio-vibration

    ```
3.  Install dependencies:
    ```bash
    npm install

    ```
4.  Link or copy the plugin folder to your DSH plugins directory.

## Configuration

You can customize the visualizer behavior in the plugin settings (if exposed via DSH UI) or by modifying the configuration file:

-   **Sensitivity:** Adjust the reaction intensity to audio levels.
-   **Color:** Customize the color of the vibration bars.
-   **Position:** Toggle the position of the spectrum bar (Right/Left).

## Dependencies

-   **NAudio:** This plugin relies on `NAudio.dll` for Windows audio capture.
    -   *Note: If running manually, ensure `NAudio.dll` is present in the root directory.*

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
