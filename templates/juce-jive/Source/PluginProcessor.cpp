#include "PluginProcessor.h"

#if APC_USE_JIVE
#include "PluginEditor.h"
#endif

#include <algorithm>
#include <cmath>
#include <memory>

juce::AudioProcessorValueTreeState::ParameterLayout {{PLUGIN_CLASS_NAME}}::createParameterLayout() {
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID { "gain", 1 },
        "Gain",
        juce::NormalisableRange<float>(0.0f, 1.0f),
        0.75f));
    return layout;
}

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
    , m_apvts(*this, nullptr, "Parameters", createParameterLayout())
    , m_gainParam(m_apvts.getRawParameterValue("gain"))
{
}

{{PLUGIN_CLASS_NAME}}::~{{PLUGIN_CLASS_NAME}}() = default;

void {{PLUGIN_CLASS_NAME}}::prepareToPlay(double sampleRate, int samplesPerBlock) {
    juce::ignoreUnused(samplesPerBlock);
    m_gainSmoothed.reset(sampleRate, 0.02);
    const float currentGain = m_gainParam != nullptr
        ? m_gainParam->load(std::memory_order_relaxed)
        : 0.75f;
    m_gainSmoothed.setCurrentAndTargetValue(currentGain);
}

void {{PLUGIN_CLASS_NAME}}::releaseResources() {}

bool {{PLUGIN_CLASS_NAME}}::isBusesLayoutSupported(const BusesLayout &layouts) const {
    const auto &mainOut = layouts.getMainOutputChannelSet();
    if (mainOut != juce::AudioChannelSet::mono()
        && mainOut != juce::AudioChannelSet::stereo())
        return false;

    return mainOut == layouts.getMainInputChannelSet();
}

void {{PLUGIN_CLASS_NAME}}::processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &) {
    juce::ScopedNoDenormals noDenormals;
    const auto totalNumInputChannels = getTotalNumInputChannels();
    const auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear(i, 0, buffer.getNumSamples());

    const auto channelsToProcess = std::min(totalNumInputChannels, totalNumOutputChannels);
    if (channelsToProcess <= 0)
        return;

    auto *const *channels = buffer.getArrayOfWritePointers();
    const int numSamples = buffer.getNumSamples();
    const float targetGain = m_gainParam != nullptr
        ? m_gainParam->load(std::memory_order_relaxed)
        : 0.75f;

    m_gainSmoothed.setTargetValue(targetGain);
    for (int sample = 0; sample < numSamples; ++sample) {
        const float gain = m_gainSmoothed.getNextValue();
        for (int channel = 0; channel < channelsToProcess; ++channel)
            channels[channel][sample] *= gain;
    }
}

juce::AudioProcessorEditor *{{PLUGIN_CLASS_NAME}}::createEditor() {
#if APC_USE_JIVE
    return new {{PLUGIN_ID}}Editor(*this);
#else
    return new juce::GenericAudioProcessorEditor(*this);
#endif
}

void {{PLUGIN_CLASS_NAME}}::getStateInformation(juce::MemoryBlock &destData) {
    const auto state = m_apvts.copyState();
    if (const auto xml = state.createXml())
        copyXmlToBinary(*xml, destData);
}

void {{PLUGIN_CLASS_NAME}}::setStateInformation(const void *data, int sizeInBytes) {
    if (const auto xml = getXmlFromBinary(data, sizeInBytes)) {
        if (xml->hasTagName(m_apvts.state.getType()))
            m_apvts.replaceState(juce::ValueTree::fromXml(*xml));
    }
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() {
    return new {{PLUGIN_CLASS_NAME}}();
}
