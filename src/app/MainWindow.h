#pragma once
#include "core/Network.h"
#include <QMainWindow>
#include <QJsonObject>
class Viewport;
class QTreeWidget;
class QTreeWidgetItem;
class QDoubleSpinBox;
class QLabel;
class QGroupBox;
class QStackedWidget;
class QTabBar;
class QUndoStack;
class QPushButton;

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    MainWindow();
    void openPath(const QString& path);
    bool smokeCheck();
protected:
    void closeEvent(QCloseEvent*) override;
private:
    mvcad::Network network_;
    QString path_;
    Viewport* viewport_{};
    QTreeWidget* tree_{};
    QDoubleSpinBox *diameter_{},*start_{},*end_{};
    QLabel *selection_{},*junctions_{},*summary_{};
    QGroupBox* parameters_{};
    QPushButton* apply_{};
    QStackedWidget* commands_{};
    QTabBar* tabs_{};
    QUndoStack* undo_{};
    int selected_=-1;
    bool rebuilding_=false;
    void createCommands();
    void createSidebar();
    void rebuild(bool fit=false);
    void selectBranch(int index);
    void applyDiameter();
    void importCsv();
    void openDialog();
    void openExample();
    bool save(bool as=false);
    bool mayDiscard();
    void newPart();
    void commit(const mvcad::Network& next,const QString& text);
    void restore(const mvcad::Network& n);
    void updateTitle();
};
