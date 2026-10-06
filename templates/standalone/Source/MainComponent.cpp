#include "MainComponent.h"

#include <cmath>

//==============================================================================
{{PLUGIN_ID}}MainComponent::{{PLUGIN_ID}}MainComponent()
{
    // 0 inputs, 2 outputs: this template *generates* audio rather than
    // processing a live input. Change the first argument to 2 to read the mic,
    // and add MICROPHONE_PERMISSION_ENABLED / MICROPHONE_PERMISSION_TEXT to
    // juce_add_gui_app() in CMakeLists.txt or macOS will deny the input.
    //
    // This call both initialises the audio device and starts the callback —
    // JUCE 9 has no separate start().
    setAudioChannels(0, 2);

    levelLabel.setText("Level", juce::dontSendNotification);
    levelLabel.attachToComponent(&levelSlider, true);

    levelSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    levelSlider.setTextBoxStyle(juce::Slider::NoTextBox, false, 0, 0);
    levelSlider.setRange(0.0, 1.0, 0.01);
    levelSlider.setValue(0.0, juce::dontSendNotification);

    // Runs on the message thread. Only touch the atomic here — never the audio
    // state directly, and never anything that could block.
    levelSlider.onValueChange = [this]
    {
        level.store(static_cast<float>(levelSlider.getValue()), std::memory_order_relaxed);
    };

    addAndMakeVisible(levelSlider);
    setSize(480, 160);
}

{{PLUGIN_ID}}MainComponent::~{{PLUGIN_ID}}MainComponent()
{
    // Required. AudioAppComponent's destructor jassert()s if the audio source is
    // still attached, so this is not optional cleanup — see the note in the
    // header. The JUCE 9 counterpart to the old stop().
    shutdownAudio();
}

//==============================================================================
void {{PLUGIN_ID}}MainComponent::prepareToPlay(int samplesPerBlockExpected, double sampleRate)
{
    // Guaranteed to be called at least once before any getNextAudioBlock(), and
    // possibly several times in a row with no releaseResources() between, so it
    // must be safe to re-enter.
    juce::ignoreUnused(samplesPerBlockExpected);

    currentSampleRate = sampleRate;
    phase = 0.0;
}

void {{PLUGIN_ID}}MainComponent::releaseResources()
{
    // Nothing was allocated in prepareToPlay, so there is nothing to free. Keep
    // the override: it is pure virtual in AudioSource.
}

void {{PLUGIN_ID}}MainComponent::getNextAudioBlock(const juce::AudioSourceChannelInfo &bufferToFill)
{
    const float currentLevel = level.load(std::memory_order_relaxed);

    // Silence must still clear the buffer. The device may hand back a buffer
    // containing another source's audio, and leaving it untouched produces
    // stuck samples rather than silence.
    if (currentLevel <= 0.0f)
    {
        bufferToFill.clearActiveBufferRegion();
        return;
    }

    // prepareToPlay() normally runs first, but the device manager can start
    // callbacks at an unexpected moment, so never divide by an unvalidated rate.
    const double rate = currentSampleRate > 0.0 ? currentSampleRate : 44100.0;
    const double phaseStep = frequencyHz * juce::MathConstants<double>::twoPi / rate;
    const int numChannels = bufferToFill.buffer->getNumChannels();

    for (int i = 0; i < bufferToFill.numSamples; ++i)
    {
        // Advance the phase ONCE per sample and write that sample to every
        // channel. Advancing it inside the channel loop would run the oscillator
        // numChannels times too fast and put the outputs out of phase.
        const auto sample = static_cast<float>(currentLevel * std::sin(phase));
        phase += phaseStep;

        for (int channel = 0; channel < numChannels; ++channel)
            bufferToFill.buffer->setSample(channel, bufferToFill.startSample + i, sample);
    }

    // Keep the phase inside one cycle. Left unbounded it grows for the lifetime
    // of the process and std::sin() steadily loses precision, so a long-running
    // app would audibly degrade.
    phase = std::fmod(phase, juce::MathConstants<double>::twoPi);
}

//==============================================================================
void {{PLUGIN_ID}}MainComponent::paint(juce::Graphics &g)
{
    g.fillAll(juce::Colours::black);

    g.setColour(juce::Colours::white);
    g.drawText("{{PLUGIN_DISPLAY_NAME}} — 440 Hz sine generator",
               getLocalBounds().removeFromTop(48),
               juce::Justification::centred);
}

void {{PLUGIN_ID}}MainComponent::resized()
{
    // getLocalBounds() is the component's own coordinate space; do not use
    // getWidth()/getHeight() to position children or the layout breaks as soon
    // as the component is not at (0, 0).
    auto area = getLocalBounds().reduced(24);
    area.removeFromTop(48);
    levelSlider.setBounds(area.removeFromTop(32));
}
