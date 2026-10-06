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
#include <type_traits>
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
    // juce_audio_basics/buffers/juce_AudioSampleBuffer.h — note JUCE 9 declares
    // `class AudioBuffer` in a file still named juce_AudioSampleBuffer.h.
    template <typename T> class AudioBuffer
    {
    public:
        int getNumSamples() const { return 0; }
        int getNumChannels() const { return 0; }
        void clear (int, int, int) {}
        void clear() {}
        const T *getReadPointer (int) const { return nullptr; }
        T *getWritePointer (int) { return nullptr; }
        T getSample (int, int) const { return {}; }
        void setSample (int destChannel, int destSample, T newValue) { (void) destChannel; (void) destSample; (void) newValue; }
    };

    class MidiBuffer {};
    class AudioChannelSet { public: static AudioChannelSet stereo() { return {}; } };

    //==========================================================================
    // juce_core/maths/juce_MathsFunctions.h — MathConstants lives there, not in
    // a file of its own.
    template <typename FloatType> struct MathConstants
    {
        static constexpr FloatType pi    = static_cast<FloatType> (3.141592653589793238L);
        static constexpr FloatType twoPi = static_cast<FloatType> (2 * 3.141592653589793238L);
        static constexpr FloatType euler = static_cast<FloatType> (2.718281828459045235L);
    };

    class Colour
    {
    public:
        Colour() = default;
        explicit Colour (std::uint32_t argb) : argbValue (argb) {}
        std::uint32_t getARGB() const { return argbValue; }
    private:
        std::uint32_t argbValue = 0;
    };

    // juce_graphics/colour/juce_Colours.h — a namespace of pre-made colours.
    namespace Colours
    {
        const Colour transparentBlack { 0 };
        const Colour black   { 0xff000000 };
        const Colour white   { 0xffffffff };
        const Colour grey    { 0xff808080 };
        const Colour red     { 0xffff0000 };
        const Colour green   { 0xff00ff00 };
        const Colour blue    { 0xff0000ff };
    }

    // juce_graphics/contexts/juce_Graphics.h takes a Justification by value; the
    // real one converts implicitly from its own Flags enum.
    class Justification
    {
    public:
        enum Flags
        {
            left            = 1,
            right           = 2,
            horizontallyCentred = 3,
            top             = 4,
            bottom          = 8,
            verticallyCentred = 12,
            centred         = 15,
            centredLeft     = 5,
            centredRight    = 6,
            centredTop      = 9,
            centredBottom   = 13
        };

        Justification (int = centred) {}
    };

    enum NotificationType
    {
        dontSendNotification = 0,
        sendNotification = 1,
        sendNotificationSync = 2,
        sendNotificationAsync = 3
    };

    template <typename T> class Rectangle
    {
    public:
        Rectangle() = default;
        Rectangle (T x, T y, T w, T h) : posX (x), posY (y), width (w), height (h) {}

        T getX() const { return posX; }
        T getY() const { return posY; }
        T getWidth() const { return width; }
        T getHeight() const { return height; }

        Rectangle reduced (T inset) const { return { posX + inset, posY + inset, width - 2 * inset, height - 2 * inset }; }
        Rectangle withTrimmedTop (T amount) const { return { posX, posY + amount, width, height - amount }; }

        // Returns the removed strip and shrinks *this*, which is how the layout
        // idiom `auto area = getLocalBounds(); slider.setBounds(area.removeFromTop(32));` works.
        Rectangle removeFromTop (T amount)
        {
            const Rectangle result { posX, posY, width, amount };
            posY += amount;
            height -= amount;
            return result;
        }

        Rectangle removeFromBottom (T amount)
        {
            const Rectangle result { posX, posY + height - amount, width, amount };
            height -= amount;
            return result;
        }

        Rectangle removeFromLeft (T amount)
        {
            const Rectangle result { posX, posY, amount, height };
            posX += amount;
            width -= amount;
            return result;
        }

        Rectangle removeFromRight (T amount)
        {
            const Rectangle result { posX + width - amount, posY, amount, height };
            width -= amount;
            return result;
        }

    private:
        T posX {}, posY {}, width {}, height {};
    };

    class Graphics;   // forward-declared: Component::paint takes it by reference

    class LookAndFeel
    {
    public:
        virtual ~LookAndFeel() = default;
        Colour findColour (int colourId) const { (void) colourId; return Colour { 0xff000000 }; }
    };

    class Desktop
    {
    public:
        static Desktop &getInstance() { static Desktop d; return d; }
        LookAndFeel &getDefaultLookAndFeel() { return laf; }
    private:
        LookAndFeel laf;
    };

    class Graphics
    {
    public:
        void setColour (Colour) {}
        void fillAll (Colour = Colour { 0 }) {}
        void fillAll() {}
        void drawText (const String &, Rectangle<int>, Justification, bool = false) {}
        void drawText (const String &, int, int, int, int, Justification, bool = false) {}
    };

    class Component
    {
    public:
        virtual ~Component() = default;
        void setBounds (Rectangle<int>) {}
        void setBounds (int, int, int, int) {}
        Rectangle<int> getLocalBounds() const { return {}; }
        Rectangle<int> getBounds() const { return {}; }
        template <typename C> void addAndMakeVisible (C &) {}
        void addAndMakeVisible (Component *) {}
        void setSize (int w, int h) { width = w; height = h; }
        void setVisible (bool) {}
        void centreWithSize (int, int) {}
        int getWidth() const { return width; }
        int getHeight() const { return height; }
        virtual void resized() {}
        virtual void paint (Graphics &) {}
    private:
        int width = 0, height = 0;
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

    //==========================================================================
    // The standalone-APPLICATION API (templates/standalone). Signatures
    // transcribed from JUCE 9.0.3:
    //   modules/juce_audio_utils/gui/juce_AudioAppComponent.h
    //   modules/juce_audio_basics/sources/juce_AudioSource.h
    //   modules/juce_events/messages/juce_ApplicationBase.h
    //   modules/juce_gui_basics/application/juce_Application.h
    //   modules/juce_gui_basics/windows/juce_DocumentWindow.h
    //   modules/juce_gui_basics/widgets/juce_Slider.h, juce_Label.h
    //==========================================================================
    class Slider : public Component
    {
    public:
        enum SliderStyle
        {
            LinearHorizontal, LinearVertical, LinearBar, LinearBarVertical,
            Rotary, RotaryHorizontalDrag, RotaryVerticalDrag,
            RotaryHorizontalVelocityDrag, RotaryVerticalVelocityDrag,
            Angular, TwoValueHorizontal, TwoValueVertical, ThreeValueHorizontal,
            ThreeValueVertical
        };

        enum TextEntryBoxPosition { NoTextBox, TextBoxLeft, TextBoxRight, TextBoxAbove, TextBoxBelow };

        Slider() = default;
        explicit Slider (const String &) {}

        void setSliderStyle (SliderStyle) {}
        void setTextBoxStyle (TextEntryBoxPosition, bool, int, int) {}
        void setRange (double, double, double = 0.0) {}
        void setValue (double, NotificationType = sendNotification) {}
        double getValue() const { return 0.0; }

        // The real member is a std::function, assigned to like a lambda.
        std::function<void()> onValueChange;
    };

    class Label : public Component
    {
    public:
        Label() = default;
        Label (const String &, const String &) {}

        void setText (const String &, NotificationType = sendNotification) {}
        const String &getText() const { return text; }
        void attachToComponent (Component *, bool) {}
        void setJustificationType (Justification) {}
    private:
        String text;
    };

    // juce_audio_basics/sources/juce_AudioSource.h
    struct AudioSourceChannelInfo
    {
        AudioSourceChannelInfo() = default;
        AudioSourceChannelInfo (AudioBuffer<float> *bufferToUse,
                                int startSampleOffset, int numSamplesToUse) noexcept
            : buffer (bufferToUse), startSample (startSampleOffset), numSamples (numSamplesToUse) {}

        AudioBuffer<float> *buffer = nullptr;
        int startSample = 0;
        int numSamples = 0;

        void clearActiveBufferRegion() const {}
    };

    class AudioSource
    {
    public:
        virtual ~AudioSource() = default;
        virtual void prepareToPlay (int samplesPerBlockExpected, double sampleRate) = 0;
        virtual void releaseResources() = 0;
        virtual void getNextAudioBlock (const AudioSourceChannelInfo &) = 0;
    };

    // juce_core/containers/juce_BigInteger.h — only the bit-range helpers the
    // audio-device setup code uses.
    class BigInteger
    {
    public:
        void clear() {}
        void setRange (int startBit, int numBits, bool shouldBeSet) { (void) startBit; (void) numBits; (void) shouldBeSet; }
        int countNumberOfSetBits() const { return 0; }
    };

    // juce_audio_device/devices/juce_AudioDeviceManager.h — declared at namespace
    // scope because AudioAppComponent exposes it as a protected member, and a
    // member cannot be typed with a nested class declared further down.
    class AudioDeviceManager
    {
    public:
        struct AudioDeviceSetup
        {
            BigInteger inputChannels, outputChannels;
            double sampleRate = 0.0;
            int bufferSize = 0;
        };

        String initialise (int, int, const XmlElement *, bool) { return {}; }
        String setAudioDeviceSetup (const AudioDeviceSetup &, bool) { return {}; }
        AudioDeviceSetup getAudioDeviceSetup() const { return {}; }
        void addAudioCallback (AudioSource *) {}
        void removeAudioCallback (AudioSource *) {}
        double getCurrentSampleRate() const { return 44100.0; }
        int getCurrentBufferSizeSamples() const { return 512; }
    };

    // juce_core/misc/juce_BigInteger.h (only the two channel masks are needed).
    // Declared after use above is fine for a member type, but BigInteger is used
    // inside AudioDeviceSetup, so it must come first — see the forward block.

    // JUCE 9: NO start() and NO stop(). setAudioChannels() starts the callback
    // and shutdownAudio() is its required counterpart — the real destructor
    // jassert()s if a source is still attached.
    class AudioAppComponent : public Component, public AudioSource
    {
    public:
        AudioAppComponent() = default;
        ~AudioAppComponent() override = default;

        void setAudioChannels (int numInputChannels, int numOutputChannels,
                               const XmlElement *storedSettings = nullptr)
        {
            (void) numInputChannels; (void) numOutputChannels; (void) storedSettings;
        }

        void shutdownAudio() {}

    protected:
        AudioDeviceManager &deviceManager = defaultDeviceManager;

    private:
        AudioDeviceManager defaultDeviceManager;
    };

    //==========================================================================
    class JUCEApplicationBase
    {
    public:
        virtual ~JUCEApplicationBase() = default;

        static JUCEApplicationBase *getInstance() noexcept { return nullptr; }
        static void quit() {}

        virtual const String getApplicationName() = 0;
        virtual const String getApplicationVersion() = 0;
        virtual bool moreThanOneInstanceAllowed() = 0;

        // Returns void in JUCE 9, not bool.
        virtual void initialise (const String &commandLineParameters) = 0;
        virtual void shutdown() = 0;
        virtual void anotherInstanceStarted (const String &commandLine) = 0;
        virtual void systemRequestedQuit() = 0;
    };

    class JUCEApplication : public JUCEApplicationBase
    {
    public:
        // Hides the base class's static so that getInstance()->systemRequestedQuit()
        // type-checks from inside an application subclass — this is exactly what
        // JUCE's own GuiApp example relies on.
        static JUCEApplication *getInstance() noexcept { return nullptr; }
    };

    //==========================================================================
    class DocumentWindow : public Component
    {
    public:
        enum TitleBarButtons
        {
            minimiseButton = 1,
            maximiseButton = 2,
            closeButton = 4,
            titleBarButtonsMask = 7,
            allButtons = 7,
            noButtons = 0
        };

        enum ColourIds
        {
            textColourId = 0x1005701,
            backgroundColourId = 0x1005700
        };

        DocumentWindow (const String &name, Colour backgroundColour,
                        int requiredButtons, bool addToDesktop = true)
        {
            (void) name; (void) backgroundColour; (void) requiredButtons; (void) addToDesktop;
        }

        ~DocumentWindow() override = default;

        void setUsingNativeTitleBar (bool) {}
        void setContentOwned (Component *, bool) {}
        void setContentNonOwned (Component *, bool) {}
        void setResizable (bool, bool) {}
        void setTitleBarHeightRequired (bool) {}

        virtual void closeButtonPressed();
    };

    class ResizableWindow : public Component
    {
    public:
        void setContentOwned (Component *, bool) {}
        void setResizable (bool, bool) {}
    };
}

//==============================================================================
// juce_generate_juce_header() writes these into the build tree's JuceHeader.h,
// filling the values from the target's PRODUCT_NAME / VERSION / COMPANY_NAME
// (JUCE 9's extras/Build/juceaide/Main.cpp is the generator).
#if ! JUCE_DONT_DECLARE_PROJECTINFO
namespace ProjectInfo
{
    const char *const projectName   = "apc-mcp-stub";
    const char *const companyName   = "stub";
    const char *const versionString = "1.0.0";
    const int         versionNumber = 0x10000;
}
#endif

// Real JUCE expands this into a platform main(). For a -fsyntax-only check the
// body is irrelevant, but it is written to still catch the two mistakes that
// matter: naming a class that does not exist, or naming one that is not an
// application.
#define START_JUCE_APPLICATION(AppClass) \
    static_assert (std::is_base_of_v<::juce::JUCEApplicationBase, AppClass>, \
                   "START_JUCE_APPLICATION requires a juce::JUCEApplication subclass"); \
    int main (int argc, char **argv) \
    { \
        juce::ignoreUnused (argc, argv); \
        (void) sizeof (AppClass); \
        return 0; \
    }
