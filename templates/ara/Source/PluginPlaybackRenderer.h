#pragma once
#include <JuceHeader.h>

#include <unordered_map>

class {{PLUGIN_CLASS_NAME}}PlaybackRenderer final : public juce::ARAPlaybackRenderer {
public:
    using juce::ARAPlaybackRenderer::ARAPlaybackRenderer;
    using juce::ARAPlaybackRenderer::processBlock;

    void prepareToPlay(double sampleRate,
                       int maximumSamplesPerBlock,
                       int numChannels,
                       juce::AudioProcessor::ProcessingPrecision precision,
                       juce::ARARenderer::AlwaysNonRealtime alwaysNonRealtime) override;
    void releaseResources() override;

    bool processBlock(juce::AudioBuffer<float> &buffer,
                      juce::AudioProcessor::Realtime realtime,
                      const juce::AudioPlayHead::PositionInfo &positionInfo) noexcept override;

private:
    struct SourceReader {
        std::unique_ptr<juce::AudioFormatReader> reader;
        juce::BufferingAudioReader *bufferedReader = nullptr;
    };

    juce::TimeSliceThread sourceReaderThread { "ARA source reader" };
    std::unordered_map<juce::ARAAudioSource *, SourceReader> sourceReaders;
    juce::AudioBuffer<float> sourceBuffer;
    double sampleRate = 44100.0;
    int maximumSamplesPerBlock = 4096;
    int numChannels = 2;
    bool usesBufferedReaders = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_CLASS_NAME}}PlaybackRenderer)
};
