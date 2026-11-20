#include "PluginProcessor.h"
#include "PluginEditor.h"

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}()
    : juce::AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

void {{PLUGIN_CLASS_NAME}}::prepareToPlay(double sampleRate, int samplesPerBlock) {
    const auto araReady = prepareToPlayForARA(sampleRate,
                                               samplesPerBlock,
                                               getTotalNumOutputChannels(),
                                               getProcessingPrecision());
    juce::ignoreUnused(araReady);
}

void {{PLUGIN_CLASS_NAME}}::releaseResources() {
    const auto araReleased = releaseResourcesForARA();
    juce::ignoreUnused(araReleased);
}

bool {{PLUGIN_CLASS_NAME}}::isBusesLayoutSupported(const BusesLayout &layouts) const {
    const auto &mainInput = layouts.getMainInputChannelSet();
    const auto &mainOutput = layouts.getMainOutputChannelSet();

    if (mainOutput != juce::AudioChannelSet::mono()
        && mainOutput != juce::AudioChannelSet::stereo())
        return false;

    return mainInput == mainOutput;
}

void {{PLUGIN_CLASS_NAME}}::processBlock(juce::AudioBuffer<float> &buffer,
                                         juce::MidiBuffer &midiMessages) {
    juce::ignoreUnused(midiMessages);
    juce::ScopedNoDenormals noDenormals;

    // An active ARA playback renderer handles the block; otherwise this effect
    // preserves the host's in-place input as a unity-gain pass-through.
    if (processBlockForARA(buffer, isRealtime(), getPlayHead()))
        return;

    const auto totalNumInputChannels = getTotalNumInputChannels();
    const auto totalNumOutputChannels = getTotalNumOutputChannels();
    for (auto channel = totalNumInputChannels; channel < totalNumOutputChannels; ++channel)
        buffer.clear(channel, 0, buffer.getNumSamples());
}

juce::AudioProcessorEditor *{{PLUGIN_CLASS_NAME}}::createEditor() {
    return new {{PLUGIN_CLASS_NAME}}Editor(*this);
}

double {{PLUGIN_CLASS_NAME}}::getTailLengthSeconds() const {
    double tailLength = 0.0;
    if (getTailLengthSecondsForARA(tailLength))
        return tailLength;

    return 0.0;
}

void {{PLUGIN_CLASS_NAME}}::getStateInformation(juce::MemoryBlock &destData) {
    // This pass-through effect has no parameters or plug-in-specific state.
    juce::ignoreUnused(destData);
}

void {{PLUGIN_CLASS_NAME}}::setStateInformation(const void *data, int sizeInBytes) {
    juce::ignoreUnused(data, sizeInBytes);
}

juce::AudioProcessorARAExtension *{{PLUGIN_CLASS_NAME}}::getARAClientExtensions() {
    return this;
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() {
    return new {{PLUGIN_CLASS_NAME}}();
}
