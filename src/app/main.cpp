#include "MainWindow.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QFileInfo>
#include <QFontDatabase>
#include <QTimer>

int main(int argc,char** argv) {
    QApplication app(argc,argv);app.setApplicationName("MVCAD");app.setOrganizationName("MVCAD");app.setApplicationVersion(MVCAD_VERSION);app.setStyle("Fusion");
    // The offscreen platform has no native font discovery on Windows. Load a
    // system font for meaningful CI screenshots; normal desktop runs use native fonts.
    if(app.platformName()=="offscreen") {
#ifdef Q_OS_WIN
        const auto fontPath=qEnvironmentVariable("WINDIR","C:/Windows")+"/Fonts/segoeui.ttf";
#else
        const QString fontPath="/System/Library/Fonts/Supplemental/Arial.ttf";
#endif
        const int id=QFontDatabase::addApplicationFont(fontPath);
        if(id>=0)app.setFont(QFont(QFontDatabase::applicationFontFamilies(id).first()));
    }
    QFont font=app.font();font.setPointSize(9);app.setFont(font);
    QCommandLineParser cli;cli.setApplicationDescription("Microvascular CAD development preview");cli.addHelpOption();cli.addVersionOption();
    cli.addOption({"smoke-test","Run a deterministic UI smoke test and exit."});
    cli.addOption({"screenshot","Save the application window as a PNG.","path"});cli.addPositionalArgument("part","Optional .mvcad part to open.");cli.process(app);
    MainWindow window;window.show();
    if(!cli.positionalArguments().isEmpty())window.openPath(cli.positionalArguments().first());
    if(cli.isSet("smoke-test"))QTimer::singleShot(100,&window,[&]{
        if(!window.smokeCheck()){app.exit(2);return;}
        QTimer::singleShot(200,&window,[&]{
            bool ok=true;if(cli.isSet("screenshot"))ok=window.grab().save(cli.value("screenshot"));app.exit(ok?0:3);
        });
    });
    else if(cli.isSet("screenshot"))QTimer::singleShot(500,&window,[&]{window.grab().save(cli.value("screenshot"));});
    return app.exec();
}
