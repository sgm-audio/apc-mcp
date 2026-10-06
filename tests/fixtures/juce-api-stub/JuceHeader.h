#pragma once
// TEST FIXTURE — NOT REAL JUCE. DO NOT SHIP, DO NOT INCLUDE FROM PRODUCT CODE.
//
// A minimal stub of the JUCE 9 C++ API, used only so tests can run
// `g++ -fsyntax-only` over scaffolded plugin sources without downloading JUCE.
//
// Every signature here was transcribed from JUCE 9.0.3 headers:
//   modules/juce_gui_extra/misc/juce_WebBrowserComponent.h   (Resource, ResourceProvider,
//                                                             Options::withResourceProvider,
//                                                             Options::withBackend,
//                                                             getResourceProviderRoot, goToURL,
//                                                             evaluateJavascript, pageAboutToLoad)
//   modules/juce_gui_basics/components/juce_Component.h      (virtual void resized)
//   modules/juce_audio_processors*/...                       (AudioProcessor, AudioParameterFloat,
//                                                             copyXmlToBinary, getXmlFromBinary)
//   modules/juce_core/{text,json,xml,network}                (String operator+, StringArray::fromTokens,
//                                                             StringPairArray, JSON::toString,
//                                                             URL::removeEscapeChars, var(Array<var>))
//
// What this proves: scaffolded sources are consistent with the documented JUCE
// API — no calls to methods that do not exist, no use-before-declaration, no
// invalid aggregate initialisation. It caught loadHTMLString, onPageAboutToLoad,
// XmlDocument::storeXmlAsString, URLParser ordering and DynamicObject brace-init.
//
// What this does NOT prove: that the sources link against real JUCE, or that
// JUCE has not since changed. The `scaffold` CI job configures against real JUCE.
//
// Keep in sync when JUCE changes; if a signature here diverges from the real
// header, this fixture starts producing false confidence.

//
// Every signature here was copied from the real JUCE 9.0.3 headers under
// /tmp/JUCE/modules so that `g++ -fsyntax-only` can validate the templates'
// use of the API. This proves the templates are *consistent with the documented
// JUCE API* — it is NOT a substitute for a real JUCE build.
//
// Verified against:
//   modules/juce_gui_extra/misc/juce_WebBrowserComponent.h
//   modules/juce_core/{text,json,xml,network}/...
//   modules/juce_audio_processors_headless/utilities/juce_AudioParameterFloat.h
//   modules/juce_audio_processors_headless/processors/juce_AudioProcessor.h

#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>
#include <cmath>

#define JUCE_WINDOWS 0
#define JUCE_MAC 0
#define JUCE_LINUX 1
#define JUCE_WEB_BROWSER 1
#define JUCE_WEB_BROWSER_RESOURCE_PROVIDER_AVAILABLE 1
#define JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(C) \
    C (const C &) = delete; C &operator= (const C &) = delete;

namespace juce
{
    template <typename T> T jmax (T a, T b) { return a > b ? a : b; }
    template <typename... Args> void ignoreUnused (Args&&...) {}

    class String;
    class var;

    class String
    {
    public:
        String() = default;
        String (const char *) {}
        String (const std::string &) {}
        String fromFirstOccurrenceOf (const String &, bool, bool) const { return {}; }
        bool startsWith (const String &) const { return false; }
        String trim() const { return {}; }
        double getDoubleValue() const { return 0.0; }
        static String fromUTF8 (const char *, int = -1) { return {}; }
        static String createStringFromData (const void *, int) { return {}; }
        bool operator== (const String &) const { return false; }
        bool operator!= (const String &) const { return false; }
    };

    class StringRef
    {
    public:
        StringRef (const char *) {}
        StringRef (const String &) {}
    };

    class StringArray
    {
    public:
        [[nodiscard]] static StringArray fromTokens (StringRef, bool) { return {}; }
        [[nodiscard]] static StringArray fromTokens (StringRef, StringRef, StringRef) { return {}; }
        int size() const { return 0; }
        String operator[] (int) const { return {}; }
        const String *begin() const { return nullptr; }
        const String *end() const { return nullptr; }
    };

    class StringPairArray
    {
    public:
        void set (const String &, const String &) {}
        String getValue (StringRef, const String &) const { return {}; }
        const String &operator[] (StringRef) const { static String s; return s; }
    };

    class Identifier
    {
    public:
        Identifier (const char *) {}
        Identifier (const String &) {}
    };

    class DynamicObject;

    template <typename T>
    class Array
    {
    public:
        void add (const T &) {}
        int size() const { return 0; }
    };

    class DynamicObject
    {
    public:
        void setProperty (const Identifier &, const var &) {}
    };

    class var
    {
    public:
        var() = default;
        var (const char *) {}
        var (const String &) {}
        var (double) {}
        var (bool) {}
        var (DynamicObject *) {}
        var (const Array<var> &) {}
        var (Array<var> &&) {}
        bool isDouble() const { return false; }
        operator double() const { return 0.0; }
        operator float() const { return 0.0f; }
        operator String() const { return {}; }
    };

    String operator+ (const char *, const String &);
    String operator+ (String, const String &);
    String operator+ (String, const char *);

    class JSON
    {
    public:
        static String toString (const var &, bool allOnOneLine = false, int maximumDecimalPlaces = 15);
    };

    class URL
    {
    public:
        static String removeEscapeChars (const String &) { return {}; }
        String getParameter (const String &, const String &) const { return {}; }
    };

    class AudioProcessor;

    class MemoryBlock
    {
    public:
        void *getData() { return nullptr; }
    };

    class XmlElement
    {
    public:
        String getTagName() const { return {}; }
    };

    class XmlDocument
    {
    public:
        static std::unique_ptr<XmlElement> parse (const String &) { return nullptr; }
    };

    class ValueTree
    {
    public:
        ValueTree() = default;
        ValueTree (const String &) {}
        static ValueTree fromXml (const XmlElement &) { return {}; }
        std::unique_ptr<XmlElement> createXml() const { return nullptr; }
        bool isValid() const { return false; }
        void setProperty (const Identifier &, const var &, void *) {}
        var getProperty (const Identifier &, const var & = {}) const { return {}; }
    };

    //==========================================================================
    class AudioProcessorParameter
    {
    public:
        virtual ~AudioProcessorParameter() = default;
    };

    class ParameterID
    {
    public:
        ParameterID() = default;
        template <typename StringLike> ParameterID (StringLike &&, int versionHint = 0) {}
    };

    template <typename T> class NormalisableRange
    {
    public:
        NormalisableRange() = default;
        NormalisableRange (T, T, T) {}
    };

    class AudioParameterFloat : public AudioProcessorParameter
    {
    public:
        AudioParameterFloat (const ParameterID &, const String &, NormalisableRange<float>, float) {}
        float get() const noexcept { return 0.0f; }
        operator float() const noexcept { return 0.0f; }
        AudioParameterFloat &operator= (float) { return *this; }
    };

    //==========================================================================
    template <typename T> class AudioBuffer
    {
    public:
        int getNumSamples() const { return 0; }
        void clear (int, int, int) {}
        const T *getReadPointer (int) const { return nullptr; }
        T *getWritePointer (int) { return nullptr; }
    };

    class MidiBuffer {};
    class AudioChannelSet { public: static AudioChannelSet stereo() { return {}; } };

    template <typename T> class Rectangle
    {
    public:
        Rectangle() = default;
    };

    class Component
    {
    public:
        virtual ~Component() = default;
        void setBounds (Rectangle<int>) {}
        Rectangle<int> getLocalBounds() const { return {}; }
        template <typename C> void addAndMakeVisible (C &) {}
        void setSize (int, int) {}
        virtual void resized() {}
    };

    class AudioProcessorEditor : public Component
    {
    public:
        AudioProcessorEditor (AudioProcessor *) {}
        virtual ~AudioProcessorEditor() = default;
    };

    class GenericAudioProcessorEditor : public AudioProcessorEditor
    {
    public:
        explicit GenericAudioProcessorEditor (AudioProcessor &) : AudioProcessorEditor (nullptr) {}
    };

    class AudioProcessor
    {
    public:
        struct BusesProperties
        {
            BusesProperties &withInput (const String &, AudioChannelSet, bool) { return *this; }
            BusesProperties &withOutput (const String &, AudioChannelSet, bool) { return *this; }
        };
        AudioProcessor() = default;
        AudioProcessor (const BusesProperties &) {}
        virtual ~AudioProcessor() = default;

        void addParameter (AudioProcessorParameter *) {}
        static void copyXmlToBinary (const XmlElement &, MemoryBlock &) {}
        static std::unique_ptr<XmlElement> getXmlFromBinary (const void *, int) { return nullptr; }

        int getTotalNumInputChannels() const { return 0; }
        int getTotalNumOutputChannels() const { return 0; }

        virtual void prepareToPlay (double, int) = 0;
        virtual void releaseResources() = 0;
        virtual void processBlock (AudioBuffer<float> &, MidiBuffer &) = 0;
        virtual AudioProcessorEditor *createEditor() = 0;
        virtual bool hasEditor() const = 0;
        virtual const String getName() const = 0;
        virtual bool acceptsMidi() const = 0;
        virtual bool producesMidi() const = 0;
        virtual double getTailLengthSeconds() const = 0;
        virtual int getNumPrograms() = 0;
        virtual int getCurrentProgram() = 0;
        virtual void setCurrentProgram (int) = 0;
        virtual const String getProgramName (int) = 0;
        virtual void changeProgramName (int, const String &) = 0;
        virtual void getStateInformation (MemoryBlock &) = 0;
        virtual void setStateInformation (const void *, int) = 0;
    };

    class Timer
    {
    public:
        virtual ~Timer() = default;
        void startTimerHz (int) {}
        void stopTimer() {}
        virtual void timerCallback() = 0;
    };

    class ScopedNoDenormals {};

    //==========================================================================
    class WebBrowserComponent : public Component
    {
    public:
        struct Resource
        {
            std::vector<std::byte> data;
            String mimeType;
        };

        using ResourceProvider = std::function<std::optional<Resource> (const String &)>;
        using EvaluationCallback = std::function<void (const var &)>;

        class Options
        {
        public:
            enum class Backend { browser, webview2 };
            [[nodiscard]] Options withResourceProvider (ResourceProvider,
                                                        std::optional<String> = std::nullopt) const { return {}; }
            [[nodiscard]] Options withBackend (Backend) const { return {}; }
        };

        WebBrowserComponent() {}
        explicit WebBrowserComponent (const Options &) {}
        virtual ~WebBrowserComponent() = default;

        void goToURL (const String &) {}
        void evaluateJavascript (const String &, EvaluationCallback = nullptr) {}
        static const String &getResourceProviderRoot();

        virtual bool pageAboutToLoad (const String &) { return true; }
    };
}
