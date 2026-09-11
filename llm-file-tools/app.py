"""Lightweight Streamlit UI for the Milestone 3 matching agent."""

from __future__ import annotations

import streamlit as st

from matching_agent import MatchingAgent, available_agent_tools, call_filesystem_tool


st.set_page_config(page_title="AI Resume Matching Agent", layout="wide")


@st.cache_resource
def get_agent() -> MatchingAgent:
    return MatchingAgent()


agent = get_agent()
if "agent_state" not in st.session_state:
    st.session_state.agent_state = agent.initial_state()
if "chat_messages" not in st.session_state:
    st.session_state.chat_messages = []

st.title("AI Resume Matching Agent")

with st.sidebar:
    st.subheader("Available Tools")
    st.caption("Milestone 1 filesystem tools and Milestone 3 agent tools")
    for tool_name in available_agent_tools():
        st.write(f"- `{tool_name}`")

    st.subheader("Filesystem Demo")
    if st.button("List resumes"):
        files = call_filesystem_tool("list_files", directory="resumes")
        if files and isinstance(files, list) and files[0].get("success") is False:
            st.error(files[0].get("error"))
        else:
            st.write(f"{len(files)} files found")
            st.dataframe(files, use_container_width=True)

    if st.button("Reset conversation"):
        st.session_state.agent_state = agent.initial_state()
        st.session_state.chat_messages = []
        st.rerun()

for message in st.session_state.chat_messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

prompt = st.chat_input("Find candidates with React and 3+ years experience")
if prompt:
    st.session_state.chat_messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Matching candidates..."):
            st.session_state.agent_state = agent.invoke(
                prompt, st.session_state.agent_state
            )
            report = st.session_state.agent_state.get("report", "")
        st.markdown(f"```text\n{report}\n```")

    st.session_state.chat_messages.append({"role": "assistant", "content": report})
