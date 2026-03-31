package com.niuma.gzh.modules.workspace.service;

import com.niuma.gzh.modules.workspace.model.vo.WorkspaceOverviewVO;

public interface WorkspaceService {
    WorkspaceOverviewVO overview(String range);
}
