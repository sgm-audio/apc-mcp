#include "MainComponent.h"

#include <memory>

//==============================================================================
// The application object.
//
// juce_add_gui_app() defines JUCE_STANDALONE_APPLICATION=1 on the target, and
// START_JUCE_APPLICATION() at the bottom of this file generates main(). There is
// no main() anywhere else in this template — do not add one, or you will get a
// duplicate-symbol link error.
//
// The app name and version come from namespace ProjectInfo, which
// juce_generate_juce_header() writes into JuceHeader.h from this target's
// PRODUCT_NAME and VERSION.
class {{PLUGIN_ID}}Application final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override    { return ProjectInfo::projectName; }
    const juce::String getApplicationVersion() override { return ProjectInfo::versionString; }
    bool moreThanOneInstanceAllowed() override          { return true; }

    //==========================================================================
    void initialise(const juce::String &commandLine) override
    {
        // Create the window here, not in the constructor: JUCE calls
        // initialise() once the message manager and the look-and-feel exist.
        juce::ignoreUnused(commandLine);
        mainWindow.reset(new MainWindow(getApplicationName()));
    }

    void shutdown() override
    {
        // Resetting the unique_ptr deletes the window, which owns (and so
        // deletes) the content component. Deleting the component runs its
        // destructor, which calls shutdownAudio() — that ordering is why the
        // window must be destroyed here rather than left to process exit.
        mainWindow = nullptr;
    }

    //==========================================================================
    void systemRequestedQuit() override
    {
        // Called when the OS or the user asks the app to quit. Ignore the
        // request to keep running (e.g. to prompt about unsaved work), or call
        // quit() to allow the close.
        quit();
    }

    void anotherInstanceStarted(const juce::String &commandLine) override
    {
        // Invoked when a second instance is launched while this one runs, with
        // that instance's command-line arguments.
        juce::ignoreUnused(commandLine);
    }

    //==========================================================================
    // The desktop window that hosts the content component.
    //
    // Keep the interesting work in MainComponent: DocumentWindow's base class
    // uses many of its own methods internally, so overriding them here is easy
    // to get wrong. If you must override one, call the base implementation too.
    class MainWindow final : public juce::DocumentWindow
    {
    public:
        explicit MainWindow(juce::String name)
            : DocumentWindow(name,
                             juce::Desktop::getInstance()
                                 .getDefaultLookAndFeel()
                                 .findColour(juce::DocumentWindow::backgroundColourId),
                             juce::DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);

            // `true` = the window takes ownership and deletes the component.
            setContentOwned(new {{PLUGIN_ID}}MainComponent(), true);

            setResizable(true, true);
            centreWithSize(getWidth(), getHeight());
            setVisible(true);

            // On iOS/Android an app is the whole screen, so JUCE's own examples
            // call setFullScreen(true) instead of the two lines above:
            //   #if JUCE_IOS || JUCE_ANDROID
            //       setFullScreen(true);
            //   #endif
        }

        void closeButtonPressed() override
        {
            // Route through the application rather than deleting the window
            // directly, so closing the window and quitting from the OS take the
            // same shutdown() path.
            getInstance()->systemRequestedQuit();
        }

    private:
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

private:
    std::unique_ptr<MainWindow> mainWindow;
};

//==============================================================================
// Generates the main() routine that launches the app.
START_JUCE_APPLICATION({{PLUGIN_ID}}Application)
