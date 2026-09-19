#pragma once
#include "core/Document.h"
#include "GeometryBuildQueue.h"
#include <QMainWindow>
#include <QJsonObject>
#include <QHash>
#include <memory>
class Viewport;class QTreeWidget;class QTreeWidgetItem;class QDoubleSpinBox;
class QLabel;class QGroupBox;class QStackedWidget;class QTabBar;class QUndoStack;class QPushButton;
class MainWindow:public QMainWindow {
    Q_OBJECT
public:
    MainWindow();
    ~MainWindow() override;
    void openPath(const QString&);
    bool smokeCheck();
    bool verificationGeometry(const QString& directory);
    bool benchmarkLargeNetwork(const QString& directory);
protected:
    void closeEvent(QCloseEvent*)override;
private:
    mvcad::Document document_;
    std::shared_ptr<const mvcad::VesselResult> geometry_;
    GeometryBuildQueue* builds_{};
    bool fitWhenReady_=false;
    QString buildError_;
    double lastBuildMs_=0;
    QString selectedBody_,path_;
    int selectedCurve_=-1,selected_=-1;
    double precision_=1e-3;
    std::vector<int> selectedPoints_;
    QHash<QString,std::vector<int>> pointGroups_;
    QHash<QString,int> pointIndices_;
    Viewport* viewport_{};
    QTreeWidget* tree_{};
    QDoubleSpinBox *diameter_{},*start_{},*end_{};
    QLabel *selection_{},*junctions_{},*summary_{},*buildStatus_{};
    QGroupBox* parameters_{};
    QPushButton* apply_{};
    QStackedWidget* commands_{};
    QTabBar* tabs_{};
    QUndoStack* undo_{};
    bool rebuilding_=false;
    void createCommands();void createSidebar();
    void rebuild(bool fit=false,bool geometryChanged=true);
    void refreshTree();void populateTreeItem(QTreeWidgetItem*);
    bool waitForBuild(int timeoutMs=120000);
    void filterTree(const QString&);
    void selectBranch(int);void applyDiameter();void assignAllDiameters();
    void importCsv();void newPointSet();void mirrorCurve();void entityVisibility(bool);void showAllGeometry();
    void openDialog();void openExample();bool save(bool as=false);bool mayDiscard();void newPart();
    void commit(const mvcad::Network&,const QString&);void commit(const mvcad::Document&,const QString&);void restore(const mvcad::Document&);
    void handleTreeSelection();void selectPoint(int,bool);
    void settings();void curveThroughPoints();void roundJunctions();
    void editCenterline();void curveDialog(int edit=-1);void datumPoints();bool dialogSmokeCheck();
    void bodyMenu(const QPoint&);void selectBody(const QString&);
    void commitBodyDisplay(const std::vector<mvcad::BodyDisplay>&,const QString&);
    void bodyVisibility(bool);void bodyTransparency();void showAllBodies();void showDependencies();
    void updateTitle();
};
