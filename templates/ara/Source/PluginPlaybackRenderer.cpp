#include "PluginPlaybackRenderer.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace {
constexpr int maxSourceSamplesPerBlock = 1 << 20;

bool isFinitePositive(double value) {
    return std::isfinite(value) && value > 0.0;
}
}

void {{PLUGIN_CLASS_NAME}}PlaybackRenderer::prepareToPlay(
    double newSampleRate,
    int newMaximumSamplesPerBlock,
    int newNumChannels,
    juce::AudioProcessor::ProcessingPrecision precision,
    juce::ARARenderer::AlwaysNonRealtime alwaysNonRealtime) {
    sourceReaders.clear();
    if (sourceReaderThread.isThreadRunning())
        sourceReaderThread.stopThread(1000);

    sampleRate = newSampleRate;
    maximumSamplesPerBlock = juce::jmax(1, newMaximumSamplesPerBlock);
    numChannels = juce::jmax(1, newNumChannels);
    usesBufferedReaders = alwaysNonRealtime == juce::ARARenderer::AlwaysNonRealtime::no;

    juce::ARAPlaybackRenderer::prepareToPlay(sampleRate,
                                              maximumSamplesPerBlock,
                                              numChannels,
                                              precision,
                                              alwaysNonRealtime);

    double largestSourceStep = 1.0;
    for (auto *region : getPlaybackRegions()) {
        if (region == nullptr)
            continue;

        auto *audioModification = region->getAudioModification();
        auto *audioSource = audioModification != nullptr
            ? audioModification->getAudioSource()
            : nullptr;
        if (audioSource == nullptr)
            continue;

        const auto playbackDuration = region->getDurationInPlaybackTime();
        const auto sourceDuration = region->getEndInAudioModificationTime()
                                  - region->getStartInAudioModificationTime();
        if (!isFinitePositive(playbackDuration) || !isFinitePositive(sourceDuration)
            || !isFinitePositive(audioSource->getSampleRate()))
            continue;

        const auto sourceStep = (sourceDuration / playbackDuration)
                              * audioSource->getSampleRate() / sampleRate;
        if (isFinitePositive(sourceStep))
            largestSourceStep = juce::jmax(largestSourceStep, sourceStep);
    }

    const auto requestedSourceSamples = std::ceil(
        static_cast<double>(maximumSamplesPerBlock) * largestSourceStep) + 2.0;
    const auto sourceCapacity = static_cast<int>(std::min(
        requestedSourceSamples, static_cast<double>(maxSourceSamplesPerBlock)));
    sourceBuffer.setSize(numChannels, juce::jmax(2, sourceCapacity), false, false, true);

    if (usesBufferedReaders)
        sourceReaderThread.startThread(juce::Thread::Priority::high);

    for (auto *region : getPlaybackRegions()) {
        if (region == nullptr)
            continue;

        auto *audioModification = region->getAudioModification();
        auto *audioSource = audioModification != nullptr
            ? audioModification->getAudioSource()
            : nullptr;
        if (audioSource == nullptr || sourceReaders.contains(audioSource))
            continue;

        auto sourceReader = std::make_unique<juce::ARAAudioSourceReader>(audioSource);
        if (!sourceReader->isValid())
            continue;

        SourceReader entry;
        if (usesBufferedReaders) {
            const auto readAheadSize = juce::jmax(4 * maximumSamplesPerBlock,
                                                   juce::roundToInt(2.0 * sampleRate));
            auto bufferedReader = std::make_unique<juce::BufferingAudioReader>(
                sourceReader.release(), sourceReaderThread, readAheadSize);
            entry.bufferedReader = bufferedReader.get();
            entry.reader = std::move(bufferedReader);
        } else {
            entry.reader = std::move(sourceReader);
        }
        sourceReaders.emplace(audioSource, std::move(entry));
    }
}

void {{PLUGIN_CLASS_NAME}}PlaybackRenderer::releaseResources() {
    sourceReaders.clear();
    sourceBuffer.setSize(0, 0);
    if (sourceReaderThread.isThreadRunning())
        sourceReaderThread.stopThread(1000);
    juce::ARAPlaybackRenderer::releaseResources();
}

bool {{PLUGIN_CLASS_NAME}}PlaybackRenderer::processBlock(
    juce::AudioBuffer<float> &buffer,
    juce::AudioProcessor::Realtime realtime,
    const juce::AudioPlayHead::PositionInfo &positionInfo) noexcept {
    if (buffer.getNumChannels() != numChannels
        || buffer.getNumSamples() > maximumSamplesPerBlock
        || !isFinitePositive(sampleRate))
        return false;

    buffer.clear();
    const auto timeInSamples = positionInfo.getTimeInSamples().orFallback(0);
    if (!positionInfo.getIsPlaying())
        return true;

    const auto blockRange = juce::Range<juce::int64>::withStartAndLength(
        timeInSamples, buffer.getNumSamples());
    bool success = true;

    for (auto *region : getPlaybackRegions()) {
        if (region == nullptr)
            continue;

        const auto playbackSampleRange = region->getSampleRange(
            sampleRate, juce::ARAPlaybackRegion::IncludeHeadAndTail::no);
        const auto renderRange = blockRange.getIntersectionWith(playbackSampleRange);
        if (renderRange.isEmpty())
            continue;

        auto *audioModification = region->getAudioModification();
        auto *audioSource = audioModification != nullptr
            ? audioModification->getAudioSource()
            : nullptr;
        const auto readerIt = audioSource != nullptr ? sourceReaders.find(audioSource)
                                                     : sourceReaders.end();
        if (audioSource == nullptr || readerIt == sourceReaders.end()
            || readerIt->second.reader == nullptr) {
            success = false;
            continue;
        }

        const auto playbackDuration = region->getDurationInPlaybackTime();
        const auto sourceStartTime = region->getStartInAudioModificationTime();
        const auto sourceDuration = region->getEndInAudioModificationTime() - sourceStartTime;
        const auto sourceSampleRate = audioSource->getSampleRate();
        if (!isFinitePositive(playbackDuration) || !isFinitePositive(sourceDuration)
            || !isFinitePositive(sourceSampleRate)) {
            success = false;
            continue;
        }

        auto &sourceReader = readerIt->second;
        if (sourceReader.bufferedReader != nullptr)
            sourceReader.bufferedReader->setReadTimeout(
                realtime == juce::AudioProcessor::Realtime::no ? 100 : 0);

        const auto sourceStep = (sourceDuration / playbackDuration)
                              * sourceSampleRate / sampleRate;
        const auto playbackStartTime = region->getStartInPlaybackTime();
        const auto firstPlaybackTime = static_cast<double>(renderRange.getStart()) / sampleRate;
        const auto firstSourceSample = (sourceStartTime
                                      + (firstPlaybackTime - playbackStartTime)
                                        * sourceDuration / playbackDuration)
                                     * sourceSampleRate;
        const auto numSamplesToRender = static_cast<int>(renderRange.getLength());
        const auto startInBuffer = static_cast<int>(renderRange.getStart() - blockRange.getStart());
        const auto lastSourceSample = firstSourceSample
                                    + static_cast<double>(numSamplesToRender - 1) * sourceStep;
        const auto sourceSampleCount = audioSource->getSampleCount();
        const auto maxSafeSourcePosition = static_cast<double>(
            std::numeric_limits<juce::int64>::max() / 2);

        if (!isFinitePositive(sourceStep) || sourceStep > maxSourceSamplesPerBlock
            || !std::isfinite(playbackStartTime) || !std::isfinite(firstSourceSample)
            || !std::isfinite(lastSourceSample)
            || std::abs(firstSourceSample) > maxSafeSourcePosition
            || std::abs(lastSourceSample) > maxSafeSourcePosition) {
            success = false;
            continue;
        }

        const auto unclampedReadStart = static_cast<juce::int64>(std::floor(firstSourceSample));
        const auto unclampedReadEnd = static_cast<juce::int64>(std::floor(lastSourceSample)) + 2;
        const auto readStart = juce::jmax<juce::int64>(0, unclampedReadStart);
        const auto readEnd = juce::jmin<juce::int64>(sourceSampleCount, unclampedReadEnd);
        const auto sourceSamplesToRead = juce::jmax<juce::int64>(0, readEnd - readStart);
        if (sourceSamplesToRead > sourceBuffer.getNumSamples()
            || sourceSamplesToRead > std::numeric_limits<int>::max()) {
            success = false;
            continue;
        }
        const auto numSourceSamples = static_cast<int>(sourceSamplesToRead);

        sourceBuffer.clear();
        if (numSourceSamples > 0
            && !sourceReader.reader->read(&sourceBuffer,
                                          0,
                                          numSourceSamples,
                                          readStart,
                                          true,
                                          true)) {
            success = false;
            continue;
        }

        const auto sourceChannelCount = audioSource->getChannelCount();
        for (int sample = 0; sample < numSamplesToRender; ++sample) {
            const auto sourcePosition = firstSourceSample + static_cast<double>(sample) * sourceStep;
            if (sourcePosition < 0.0 || sourcePosition >= static_cast<double>(sourceSampleCount))
                continue;

            const auto lowerSourceSample = static_cast<juce::int64>(std::floor(sourcePosition));
            const auto upperSourceSample = juce::jmin<juce::int64>(
                sourceSampleCount - 1, lowerSourceSample + 1);
            const auto lowerIndex = static_cast<int>(lowerSourceSample - readStart);
            const auto upperIndex = static_cast<int>(upperSourceSample - readStart);
            if (lowerIndex < 0 || upperIndex >= numSourceSamples)
                continue;

            const auto fraction = static_cast<float>(sourcePosition
                                                    - static_cast<double>(lowerSourceSample));
            const auto outputSample = startInBuffer + sample;
            for (int channel = 0; channel < numChannels; ++channel) {
                if (sourceChannelCount <= 0)
                    continue;
                const auto sourceChannel = juce::jmin(channel, sourceChannelCount - 1);
                const auto *samples = sourceBuffer.getReadPointer(sourceChannel);
                const auto value = samples[lowerIndex]
                                 + (samples[upperIndex] - samples[lowerIndex]) * fraction;
                buffer.addSample(channel, outputSample, value);
            }
        }
    }

    return success;
}
