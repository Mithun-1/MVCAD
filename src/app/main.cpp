#include "MainWindow.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QFileInfo>
#include <QFile>
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
    cli.addOption({"verify-bifurcation","Create and validate a mirrored reference bifurcation; save part, screenshots and report.","directory"});
    cli.addOption({"benchmark-network","Measure a 1000-body and 50000-point UI workload; save screenshot and report.","directory"});
    cli.addOption({"smoke-test","Run a deterministic UI smoke test and exit."});
    cli.addOption({"screenshot","Save the application window as a PNG.","path"});cli.addPositionalArgument("part","Optional .mvcad part to open.");cli.process(app);
    MainWindow window;window.show();
    if(!cli.positionalArguments().isEmpty())window.openPath(cli.positionalArguments().first());
    if(cli.isSet("verify-bifurcation"))QTimer::singleShot(100,&window,[&]{try{app.exit(window.verificationGeometry(cli.value("verify-bifurcation"))?0:2);}catch(const std::exception& error){QFile report(cli.value("verify-bifurcation")+"/failure.txt");if(report.open(QIODevice::WriteOnly))report.write(error.what());app.exit(4);}});
    else if(cli.isSet("benchmark-network"))QTimer::singleShot(100,&window,[&]{try{app.exit(window.benchmarkLargeNetwork(cli.value("benchmark-network"))?0:2);}catch(const std::exception& error){QFile report(cli.value("benchmark-network")+"/failure.txt");if(report.open(QIODevice::WriteOnly))report.write(error.what());app.exit(4);}});
    else if(cli.isSet("smoke-test"))QTimer::singleShot(100,&window,[&]{
        app.setProperty("mvcadVerificationDirectory",QFileInfo(cli.value("screenshot")).absolutePath());
        try{if(!window.smokeCheck()){app.exit(2);return;}}
        catch(const std::exception& e){QFile report(QFileInfo(cli.value("screenshot")).absolutePath()+"/ui-smoke-error.txt");if(report.open(QIODevice::WriteOnly))report.write(e.what());app.exit(4);return;}
        QTimer::singleShot(200,&window,[&]{
            bool ok=true;if(cli.isSet("screenshot"))ok=window.grab().save(cli.value("screenshot"));app.exit(ok?0:3);
        });
    });
    else if(cli.isSet("screenshot"))QTimer::singleShot(500,&window,[&]{window.grab().save(cli.value("screenshot"));});
    return app.exec();
}
